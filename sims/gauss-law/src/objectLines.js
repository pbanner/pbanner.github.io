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
import { SNAP_STEP } from './geometry.js';

const TICK = SNAP_STEP;

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
// whole numbers a and b, frac(0.5 + a A1 + b A2) fills 0..1 evenly however
// many (a, b) pairs there are. A1 and A2 are 1/g and 1/g^2 for g the
// "plastic number", the 2D analogue of the golden ratio.
const A1 = 0.7548776662466927;
const A2 = 0.5698402909980532;
const r2 = (a, b) => (((0.5 + a * A1 + b * A2) % 1) + 1) % 1;

// The two axes other than `axis`, in order.
const across = (axis) => [0, 1, 2].filter((k) => k !== axis);

// An object's charge in units of q, per world unit of length for a rod and
// per world unit of area for a plane.
function chargeAmount(obj) {
  const { key } = CHARGE_SETTINGS[obj.kind];
  if (obj.kind === 'rod') return Math.abs(obj[key]) / TICK;
  if (obj.kind === 'plane') return Math.abs(obj[key]) / (TICK * TICK);
  return Math.abs(obj[key]);
}

// The seeds of a sphere, rod or plane: [{ point, normal, u }]. `normal` is
// the surface's outward unit normal at a surface seed (where lines can
// leave from either side), or null at a volume seed (where one line leaves
// along the field). Seeds outside the box are left out.
export function objectSeeds(obj, linesPerUnitCharge, halfExtent) {
  const seeds = [];
  const inBox = (p) => p.every((v) => Math.abs(v) <= halfExtent);
  const add = (point, normal, u) => {
    if (inBox(point)) seeds.push({ point, normal, u });
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
      const r = obj.form === 'shell' ? obj.radius : obj.radius * Math.cbrt(us[i]);
      add(c.map((v, k) => v + r * d[k]), obj.form === 'shell' ? d : null, us[i]);
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
          add(point, normal, r2(ring, group));
        }
      }
    }
    return seeds;
  }

  if (obj.kind === 'plane') {
    // A square lattice over the box's cross-section, centered on the
    // middle of the box, with lines per unit area = perArea. A sheet's
    // lines can leave from either side of each lattice point. A slab's
    // seeds come in mirror-image pairs, d either side of its middle (d
    // spread evenly over half its thickness), so the lattice has half as
    // many points.
    const perArea = linesPerUnitCharge * chargeAmount(obj);
    const slab = obj.form === 'slab';
    const spacing = 1 / Math.sqrt(slab ? perArea / 2 : perArea);
    const [u, v] = across(obj.axis);
    const count = Math.floor(halfExtent / spacing + 0.5); // lattice points per side of the middle
    for (let i = -count; i < count; i++) {
      for (let j = -count; j < count; j++) {
        // The point's symmetric group: mirroring across the middle or
        // swapping the two directions maps the lattice to itself.
        const fi = i >= 0 ? i : -i - 1;
        const fj = j >= 0 ? j : -j - 1;
        const [g0, g1] = [Math.min(fi, fj), Math.max(fi, fj)];
        const base = [0, 0, 0];
        base[obj.axis] = c[obj.axis];
        base[u] = (i + 0.5) * spacing;
        base[v] = (j + 0.5) * spacing;
        const normal = [0, 0, 0];
        normal[obj.axis] = 1;
        if (!slab) {
          add(base, normal, r2(g0, g1));
        } else {
          const d = (obj.thickness / 2) * r2(g1, g0);
          for (const side of [-1, 1]) {
            const point = [...base];
            point[obj.axis] += side * d;
            add(point, null, r2(g0, g1));
          }
        }
      }
    }
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
