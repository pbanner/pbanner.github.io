// Where field lines start in a 2D cut (see cutPlanes.js). Plain JS, no
// React or three.js.
//
// In a valid cut the field has no component across the cut, so a line
// that starts in it, heading along it, stays in it: the lines drawn in a
// cut are true field lines, traced by fieldLines.js just as in 3D. What's
// different is where they start, and how many lines each charge gets.
//
// In a cut, the lines' spacing can't follow the field's strength the way
// it does in 3D: a point charge's field falls off as 1/r^2, but its lines,
// spread around a circle, only thin out as 1/r. So the different kinds of
// charge are put on the same footing at one distance, REFERENCE_DISTANCE:
// there, each kind's lines are as closely spaced as a point charge's would
// be where its field is as strong. With N lines per unit charge
// (LINES_PER_UNIT_CHARGE_2D), at r0 = REFERENCE_DISTANCE, a point charge's
// lines are N / (2 pi r0) per unit length where its field is q / r0^2, so
// lines per unit length = (N r0 / 2 pi) x field. Then:
//   - a point charge or sphere: N lines per unit charge, at equal angles
//     around it -- from its center, from a shell's circle, or from radii
//     through a solid ball that enclose the right fractions of its charge;
//   - a rod crossing the cut at right angles (seen in the cut as a point):
//     its field is 2 lambda / r, so 2 N r0 lambda lines around it -- and
//     since its field and its lines both fall off as 1/r, that's right at
//     every distance, not just r0;
//   - a rod lying in the cut: its field at r0 is 2 lambda / r0, so
//     N lambda / pi lines per unit length on each side of it;
//   - a charged plane crossing the cut along a line: its field is 2 pi
//     sigma, so N r0 sigma lines per unit length on each side.
// (Lambda and sigma per world unit here, converted from the per-tick
// settings.)
import { SNAP_STEP } from './geometry.js';

// Lines per unit charge at each density setting (1-5). Multiples of 4, so
// every set includes the four directions along the cut's own two axes and
// keeps the quarter-turn and mirror symmetries a charge in the cut has.
export const LINES_PER_UNIT_CHARGE_2D = [4, 8, 12, 16, 20];

const REFERENCE_DISTANCE = 2.5; // world units: 5 ticks, half way to the box's edge
const TICK = SNAP_STEP;
const LINE_ROD_START = 0.06; // where a thin rod's lines start (objectLines.js's LINE_ROD_RADIUS)
const GOLDEN = 0.6180339887498949;
const PLASTIC = 0.7548776662466927;
const across = (axis) => [0, 1, 2].filter((k) => k !== axis);

// n directions at equal angles in the cut perpendicular to `axis`,
// starting along its first in-cut axis, with thresholds (see
// seedDirections.js's seedThresholds): spread evenly over 0..1, in
// farthest-point order around the circle.
const circleCache = new Map();
export function circleDirections(n, axis) {
  const key = `${n}-${axis}`;
  if (!circleCache.has(key)) {
    const [u, v] = across(axis);
    const directions = Array.from({ length: n }, (_, j) => {
      const d = [0, 0, 0];
      d[u] = Math.cos((2 * Math.PI * j) / n);
      d[v] = Math.sin((2 * Math.PI * j) / n);
      return d;
    });
    // Farthest-point order: each next angle is whichever is farthest
    // (around the circle) from all those taken so far.
    const thresholds = new Array(n);
    const gap = (i, j) => Math.min(Math.abs(i - j), n - Math.abs(i - j));
    const closest = new Array(n).fill(Infinity);
    let next = 0;
    for (let rank = 0; rank < n; rank++) {
      thresholds[next] = (rank + 0.5) / n;
      let best = -1;
      for (let i = 0; i < n; i++) {
        if (thresholds[i] !== undefined) continue;
        closest[i] = Math.min(closest[i], gap(i, next));
        if (best < 0 || closest[i] > closest[best]) best = i;
      }
      next = best;
    }
    circleCache.set(key, { directions, thresholds });
  }
  return circleCache.get(key);
}

// How many lines a point charge in the cut starts: per unit charge, times
// its charge.
export function pointLineCount(q, density) {
  return LINES_PER_UNIT_CHARGE_2D[density - 1] * Math.abs(q);
}

// The seeds of a sphere, rod or plane in the cut, in the same form as
// objectLines.js's objectSeeds: [{ point, normal, u }].
export function cutObjectSeeds(obj, cut, density, halfExtent) {
  const perUnit = LINES_PER_UNIT_CHARGE_2D[density - 1];
  const { axis, offset } = cut;
  const inBox = (p) => p.every((x) => Math.abs(x) <= halfExtent);
  const center = [...obj.position];
  center[axis] = offset;
  const seeds = [];

  // A source at a point, as seen in the cut: a sphere, or a rod crossing
  // it at right angles. A solid's seeds are at the radius enclosing a
  // fraction u of its charge: (r / R)^3 = u for a ball, (r / R)^2 = u for
  // a cylinder's cross-section.
  const radial = (count, startRadius, solidPower) => {
    const { directions, thresholds } = circleDirections(count, axis);
    directions.forEach((d, i) => {
      const r = solidPower ? obj.radius * thresholds[i] ** (1 / solidPower) : startRadius;
      const point = center.map((x, k) => x + r * d[k]);
      if (inBox(point)) seeds.push({ point, normal: solidPower ? null : d, u: thresholds[i] });
    });
  };
  if (obj.kind === 'sphere') {
    radial(perUnit * Math.abs(obj.q), obj.radius, obj.form === 'solid' ? 3 : 0);
    return seeds;
  }
  if (obj.kind === 'rod' && obj.axis === axis) {
    // 2 N r0 lambda lines, rounded to a multiple of 4 to keep the cut's
    // symmetry.
    const lambda = Math.abs(obj.lambda) / TICK;
    const count = 4 * Math.max(1, Math.round((2 * perUnit * REFERENCE_DISTANCE * lambda) / 4));
    if (obj.form === 'line') radial(count, LINE_ROD_START, 0);
    else radial(count, obj.radius, obj.form === 'solid' ? 2 : 0);
    return seeds;
  }

  // Lines from points spaced evenly along a line in the cut -- a rod lying
  // in it, or where a charged plane crosses it -- symmetric about the
  // middle of the box. At each point, `add(base, fold)` adds that point's
  // seeds; mirror-image points (fold) get the same thresholds.
  const along = (dir, perLength, add) => {
    const spacing = 1 / perLength;
    const count = Math.floor(halfExtent / spacing + 0.5);
    for (let i = -count; i < count; i++) {
      const base = [...center];
      base[dir] = (i + 0.5) * spacing;
      add(base, i >= 0 ? i : -i - 1);
    }
  };
  const push = (point, normal, u) => {
    if (inBox(point)) seeds.push({ point, normal, u });
  };
  const goldenU = (fold) => ((fold + 0.5) * GOLDEN) % 1;
  const plasticU = (fold) => ((fold + 0.5) * PLASTIC) % 1;

  if (obj.kind === 'rod') {
    // Lying in the cut: N lambda / pi lines per unit length each side, so
    // a seed on each side at that spacing (on the surface, or for a solid
    // cylinder at mirror-image depths enclosing a fraction of its charge).
    const lambda = Math.abs(obj.lambda) / TICK;
    const side = [0, 1, 2].find((k) => k !== axis && k !== obj.axis);
    along(obj.axis, (perUnit * lambda) / Math.PI, (base, fold) => {
      for (const s of [-1, 1]) {
        const n = [0, 0, 0];
        n[side] = s;
        if (obj.form === 'solid') push(base.map((x, k) => x + s * obj.radius * Math.sqrt(plasticU(fold)) * n[k]), null, goldenU(fold));
        else push(base.map((x, k) => x + (obj.form === 'line' ? LINE_ROD_START : obj.radius) * n[k]), n, goldenU(fold));
      }
    });
    return seeds;
  }

  if (obj.kind === 'plane') {
    // Crossing the cut: N r0 sigma lines per unit length each side. A
    // sheet's seeds can send a line out either side (as in 3D, depending
    // on the field there), half each way when it's alone, so they're
    // twice as dense; a slab's come in mirror-image pairs, a depth d either
    // side of its middle.
    const sigma = Math.abs(obj.sigma) / (TICK * TICK);
    const perSide = perUnit * REFERENCE_DISTANCE * sigma;
    const dir = [0, 1, 2].find((k) => k !== axis && k !== obj.axis);
    center[obj.axis] = obj.position[obj.axis];
    const normal = [0, 0, 0];
    normal[obj.axis] = 1;
    if (obj.form === 'sheet') {
      along(dir, 2 * perSide, (base, fold) => push(base, normal, goldenU(fold)));
    } else {
      along(dir, perSide, (base, fold) => {
        const d = (obj.thickness / 2) * plasticU(fold);
        for (const s of [-1, 1]) {
          const point = [...base];
          point[obj.axis] += s * d;
          push(point, null, goldenU(fold));
        }
      });
    }
    return seeds;
  }
  return seeds;
}
