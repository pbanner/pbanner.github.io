// Where field lines start on the charged spheres, rods and planes, and the
// geometry fieldLines.js needs to end lines inside them. Plain JS, no React
// or three.js.
//
// Every line carries the same amount of field flux, so an object's lines
// are spread in proportion to its charge, at the same number of lines per
// unit of charge as a point charge's:
//   - on a shell or sheet (charge on a surface), lines start on the
//     surface, evenly spread over it;
//   - in a solid ball, solid cylinder or slab (charge through a volume),
//     they start throughout the volume, evenly spread through it.
// Each starting point ("seed") also gets a threshold u from 0 to 1, which
// decides which side a surface's lines leave from and where a line ends
// inside a negatively charged object (see fieldLines.js). Seeds that are
// mirror images or rotations of each other under the object's symmetry
// get the same u, so the picture keeps the arrangement's symmetry.
import { seedDirections, seedThresholds } from './seedDirections.js';
import { CHARGE_SETTINGS } from './chargeTypes.js';
import { CM } from './geometry.js';

// A thin rod's lines start this far from its axis -- just outside it as
// drawn (ChargedObject.jsx's LINE_ROD_RADIUS) -- and a line reaching this
// close to a negative thin rod's axis ends on it.
export const LINE_ROD_RADIUS = 0.06;

// A rod's lines start out in rings around it. A ring has a multiple of 4
// lines (so it includes the two axes across the rod), as many as makes the
// gap between neighbors in a ring, at RING_SPACING_RADIUS from the rod,
// about the same as the gap between rings.
const RING_SPACING_RADIUS = 1.5;

// Thresholds for the seeds of rods and planes, from the "R2" sequence: for
// whole numbers a and b, frac(R2_START + a A1 + b A2) fills 0..1 evenly
// however many (a, b) pairs there are. A1 and A2 are 1/g and 1/g^2 for g
// the "plastic number", the 2D analogue of the golden ratio. R2_START
// isn't 1/2, so no threshold is exactly 1/2: a lone sheet sends exactly
// half its flux each way, and a threshold equal to that fraction would be
// decided by rounding errors.
const A1 = 0.7548776662466927;
const A2 = 0.5698402909980532;
const R2_START = 0.3;
const r2 = (a, b) => (((R2_START + a * A1 + b * A2) % 1) + 1) % 1;

// The two axes other than `axis`, in order.
const across = (axis) => [0, 1, 2].filter((k) => k !== axis);

// An object's charge in nC, per world unit of length for a rod and
// per world unit of area for a plane.
function chargeAmount(obj) {
  const { key } = CHARGE_SETTINGS[obj.kind];
  if (obj.kind === 'rod') return Math.abs(obj[key]) / CM;
  if (obj.kind === 'plane') return Math.abs(obj[key]) / (CM * CM);
  return Math.abs(obj[key]);
}

// The seeds of a sphere, rod or plane: [{ point, normal, u }]. `normal` is
// the surface's outward unit normal at a surface seed (where lines can
// leave from either side), or null at a volume seed (where one line leaves
// along the field). A thin rod's seeds also have an `origin`, the point on
// its axis where their lines are drawn from, and a sheet's a `layer` (see
// below). Seeds outside the box are left out.
export function objectSeeds(obj, linesPerUnitCharge, halfExtent) {
  const seeds = [];
  const inBox = (p) => p.every((v) => Math.abs(v) <= halfExtent);
  const add = (point, normal, u, origin, layer) => {
    if (inBox(point)) seeds.push({ point, normal, u, ...(origin ? { origin } : {}), ...(layer !== undefined ? { layer } : {}) });
  };
  const c = obj.position;

  if (obj.kind === 'sphere') {
    // The same symmetric directions as a point charge of the same charge.
    // A solid ball's seed in direction d sits at the radius enclosing a
    // fraction u of its charge: (r / R)^3 = u.
    const n = linesPerUnitCharge * chargeAmount(obj);
    const dirs = seedDirections(n);
    const us = seedThresholds(n);
    dirs.forEach((d, i) => {
      if (obj.form === 'shell') {
        add(c.map((v, k) => v + obj.radius * d[k]), d, us[i]);
        return;
      }
      // (`radial` says how the depth follows from the threshold. Mirror
      // images' thresholds, and so depths, differ; fieldLines.js uses it to
      // tell which seeds are mirror images all the same.)
      const point = c.map((v, k) => v + obj.radius * Math.cbrt(us[i]) * d[k]);
      if (inBox(point)) seeds.push({ point, normal: null, u: us[i], radial: { center: c, dir: d, R: obj.radius, power: 3 } });
    });
    return seeds;
  }

  if (obj.kind === 'rod') {
    const perLength = linesPerUnitCharge * chargeAmount(obj); // lines per world unit of rod
    const perRing = 4 * Math.max(1, Math.round(Math.sqrt(2 * Math.PI * RING_SPACING_RADIUS * perLength) / 4));
    const ringGap = perRing / perLength;
    const [u, v] = across(obj.axis);
    // Rings at +/-ringGap/2, +/-3 ringGap/2, ...: symmetric about the
    // rod's middle.
    for (let ring = 0; (ring + 0.5) * ringGap <= halfExtent; ring++) {
      for (const side of [-1, 1]) {
        const along = side * (ring + 0.5) * ringGap;
        for (let m = 0; m < perRing; m++) {
          const angle = (2 * Math.PI * m) / perRing;
          // Which of the ring's symmetric groups the angle is in (rotating
          // by a quarter turn or mirroring maps a group to itself).
          const quarter = perRing / 4;
          const a = m % quarter;
          const group = Math.min(a, quarter - a);
          const radial = [0, 0, 0];
          radial[u] = Math.cos(angle);
          radial[v] = Math.sin(angle);
          let r;
          let normal = radial;
          if (obj.form === 'line') r = LINE_ROD_RADIUS;
          else if (obj.form === 'shell') r = obj.radius;
          else {
            // Inside a solid cylinder, at the radius enclosing a fraction
            // of its charge: (r / R)^2 = that fraction.
            r = obj.radius * Math.sqrt(r2(group, ring));
            normal = null;
          }
          const point = c.map((x, k) => x + r * radial[k]);
          point[obj.axis] = along;
          const origin = obj.form === 'line' ? c.map((x, k) => (k === obj.axis ? along : x)) : null;
          add(point, normal, r2(ring, group), origin);
        }
      }
    }
    return seeds;
  }

  if (obj.kind === 'plane') {
    // Square lattices over the box's cross-section, centered on the middle
    // of the box. perArea is the sheet's lines per unit area, counting both
    // sides.
    const perArea = linesPerUnitCharge * chargeAmount(obj);
    const [u, v] = across(obj.axis);
    const normal = [0, 0, 0];
    normal[obj.axis] = 1;
    // A point of a lattice with this spacing, and its symmetric group
    // (mirroring across the middle or swapping the two directions maps
    // the lattice to itself): `fold` takes a lattice index to the same
    // index for every point in the group.
    const lattice = (spacing, offset, fold, visit) => {
      const count = Math.floor(halfExtent / spacing + 1);
      for (let i = -count; i <= count; i++) {
        for (let j = -count; j <= count; j++) {
          const base = [0, 0, 0];
          base[obj.axis] = c[obj.axis];
          base[u] = (i + offset) * spacing;
          base[v] = (j + offset) * spacing;
          const [fi, fj] = [fold(i), fold(j)];
          visit(base, Math.min(fi, fj), Math.max(fi, fj));
        }
      }
    };
    const cellCentered = (i) => (i >= 0 ? i : -i - 1);
    const onPoints = (i) => Math.abs(i);
    if (obj.form === 'slab') {
      // A slab's seeds come in mirror-image pairs, d either side of its
      // middle (d spread evenly over half its thickness), so the lattice
      // has half as many points.
      lattice(1 / Math.sqrt(perArea / 2), 0.5, cellCentered, (base, g0, g1) => {
        const d = (obj.thickness / 2) * r2(g1, g0);
        for (const side of [-1, 1]) {
          const point = [...base];
          point[obj.axis] += side * d;
          add(point, null, r2(g0, g1));
        }
      });
      return seeds;
    }
    // A sheet: two lattices, each with half its lines per unit area, the
    // second offset by half a spacing from the first (together, a square
    // lattice at 45 degrees). Each point is a seed on both sides of the
    // sheet, with a `layer`, 0 or 1, which fieldLines.js uses to decide
    // which sides it starts lines on: where one side gets a share f of the
    // sheet's flux, a layer-0 point starts a line on it if its threshold
    // is below 2f, and a layer-1 point if it's below 2f - 1. Then each side
    // gets (perArea / 2) x 2f = perArea x f lines per unit area, as it
    // should, and they're spread as evenly as possible: a lone sheet
    // (f = 1/2 each way) starts a line both ways from every layer-0 point
    // -- a regular grid of lines through it -- and a capacitor's plate
    // (f = 1 inward) one inward from every point of both.
    const spacing = 1 / Math.sqrt(perArea / 2);
    lattice(spacing, 0.5, cellCentered, (base, g0, g1) => add(base, normal, r2(g0, g1), null, 0));
    lattice(spacing, 0, onPoints, (base, g0, g1) => add(base, normal, r2(g1, g0), null, 1));
    return seeds;
  }
  return seeds;
}

// The geometry of an object as somewhere lines can end (a "sink"), or null
// for a point charge (fieldLines.js handles those itself):
//   surface: { level(p), normal(p) } for a shell or sheet: level is
//     negative on one side, positive on the other, and normal points from
//     the negative side to the positive;
//   volume: { inside(p), density } for a solid, solid cylinder or slab:
//     density is the charge per world unit of volume (its size);
//   line: { distance(p), foot(p) } for a thin rod: the distance from its
//     axis, and the nearest point on the axis.
export function sinkGeometry(obj) {
  const c = obj.position;
  if (obj.kind === 'sphere') {
    const r = (p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    if (obj.form === 'shell') {
      return { surface: { level: (p) => r(p) - obj.radius, normal: (p) => p.map((v, k) => (v - c[k]) / r(p)) } };
    }
    return { volume: { inside: (p) => r(p) < obj.radius, density: chargeAmount(obj) / ((4 / 3) * Math.PI * obj.radius ** 3) } };
  }
  if (obj.kind === 'rod') {
    const offset = (p) => p.map((v, k) => (k === obj.axis ? 0 : v - c[k]));
    const s = (p) => Math.hypot(...offset(p));
    if (obj.form === 'line') {
      return { line: { distance: s, foot: (p) => p.map((v, k) => (k === obj.axis ? v : c[k])) } };
    }
    if (obj.form === 'shell') {
      return { surface: { level: (p) => s(p) - obj.radius, normal: (p) => offset(p).map((v) => v / s(p)) } };
    }
    return { volume: { inside: (p) => s(p) < obj.radius, density: chargeAmount(obj) / (Math.PI * obj.radius ** 2) } };
  }
  if (obj.kind === 'plane') {
    const d = (p) => p[obj.axis] - c[obj.axis];
    if (obj.form === 'sheet') {
      const n = [0, 0, 0];
      n[obj.axis] = 1;
      return { surface: { level: d, normal: () => n } };
    }
    return { volume: { inside: (p) => Math.abs(d(p)) < obj.thickness / 2, density: chargeAmount(obj) / obj.thickness } };
  }
  return null;
}
