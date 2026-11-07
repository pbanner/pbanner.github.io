// Electric field lines for point charges and charged objects (spheres,
// rods and planes). Plain JS, no React or three.js, so it can be tested on
// its own (FieldLines.jsx draws them).
//
// The field is the superposition of every charge's own field, with the
// Coulomb constant set to 1 (chargeField.js computes it).
//
// A field line is a curve tangent to E everywhere, so it's traced by
// repeatedly stepping a short distance along the field's direction:
//   - Every line carries the same amount of flux, so each charge's lines
//     are in proportion to its charge (the picture Gauss's law is about).
//     A point charge's start on a small sphere around it, at one of a
//     fixed set of directions (see seedDirections.js); an object's start
//     on its surface or through its volume (see objectLines.js).
//   - Lines from positive charges are traced along E; lines from negative
//     charges against E (and then reversed), so every returned line runs
//     in the direction of the field.
//   - A line stops when it leaves the world cube (clipped exactly at the
//     cube's face), runs into another charge, reaches a point where the
//     field vanishes, or gets implausibly long.
//   - A line entering a negatively charged object (or, traced backward, a
//     positive one) ends somewhere inside it: see traceLine.
//   - Lines connecting a positive charge to a negative one would otherwise
//     be drawn twice, once from each end. So they're drawn only from the
//     positive end, and each negative charge adds just enough lines of its
//     own (from the cube's edge, or from a point where the field vanishes)
//     to bring it to the same count as every other unit charge -- see
//     computeFieldLines. Equal counts matter here: lines only begin and end
//     at charges, so the net number crossing any closed surface then counts
//     the charge inside it, which is Gauss's law.
import { fieldAt, objectField } from './chargeField.js';
import { chargeSign } from './chargeTypes.js';
import { LINES_PER_UNIT_CHARGE, seedDirections, seedThresholds } from './seedDirections.js';
import { objectSeeds, sinkGeometry, LINE_ROD_RADIUS } from './objectLines.js';
import { circleDirections, cutObjectSeeds, pointLineCount } from './cutLines.js';
import { arrangementSymmetries, seedOrbits } from './symmetry.js';

// Step size bounds, in world units. Steps shrink near charges (where lines
// curve sharply) down to MIN_STEP, and grow to MAX_STEP far from them.
const MIN_STEP = 0.01;
const MAX_STEP = 0.08;
const STEP_PER_DISTANCE = 0.25; // step = this x distance to nearest charge, clamped
// A line longer than this is assumed to be circling numerically (e.g.
// near a point where the field vanishes) and is cut off.
const MAX_LINE_LENGTH = 60;
// Below this field strength, the field's direction is meaningless.
const MIN_FIELD = 1e-9;
// Near a point where the field vanishes, the charges' contributions cancel:
// |E| becomes small compared with sum(|q_i| / r_i^2), the strength the
// field would have if every contribution lined up. Their ratio is 1 next
// to a lone charge and only approaches 0 near such a point (it stays above
// about 0.03 everywhere in the world cube even far from a dipole). A line
// stops once the ratio falls below NULL_RATIO, and steps are kept below
// NULL_STEP_FACTOR x the ratio while it's small. Near a null the ratio is
// roughly proportional to the distance to it, so steps shrink as a line
// approaches and it stops short instead of stepping past.
//
// That matters at a saddle point, where lines flow in along one direction
// and out along another (e.g. at the center of a square of alternating
// charges). A line aimed exactly into it is balanced on a knife edge: a
// step past it can turn either way depending on rounding errors of 1e-16,
// so two mirror-image lines could end up in different places.
const NULL_RATIO = 0.01;
const NULL_STEP_FACTOR = 0.8;
// A line that stops near a point where the field vanishes is finished at
// that point (see nullPointAhead), found by searching this far straight
// ahead in steps of NULL_SEARCH_STEP.
const NULL_SEARCH_DISTANCE = 0.2;
const NULL_SEARCH_STEP = 0.002;

// Starting directions: each unit of charge gets one of seedDirections.js's
// symmetric sets, which the density setting picks the size of.
//
// (When an arrangement's symmetry swaps positive and negative charges, as
// in a dipole or a square of alternating charges, the field on the mirror
// plane points straight through it, so every line crossing that plane is
// its own mirror image. Lines from a positive charge therefore arrive at
// the mirrored negative charge along mirrored starting directions, and
// dropping that charge's own duplicates (see computeFieldLines) keeps the
// symmetry.)
export const FIELD_LINE_DENSITY_LEVELS = LINES_PER_UNIT_CHARGE.length;

// |E| / (the sum of each source's own |E|) at p -- see NULL_RATIO -- and
// the distance from p to the nearest point charge or thin rod (where lines
// bunch up and curve sharply).
function cancellationAndNearest(p, sources) {
  let ex = 0;
  let ey = 0;
  let ez = 0;
  let scale = 0;
  let nearest = Infinity;
  for (const source of sources) {
    const e = objectField(source, p);
    ex += e[0];
    ey += e[1];
    ez += e[2];
    scale += Math.hypot(e[0], e[1], e[2]);
    if (source.kind === 'point') {
      const [sx, sy, sz] = source.position;
      nearest = Math.min(nearest, Math.hypot(p[0] - sx, p[1] - sy, p[2] - sz));
    } else if (source.kind === 'rod' && source.form === 'line') {
      const d = p.map((v, k) => (k === source.axis ? 0 : v - source.position[k]));
      nearest = Math.min(nearest, Math.hypot(...d));
    }
  }
  return { ratio: Math.hypot(ex, ey, ez) / scale, nearest };
}

// The unit vector along E (times `sign`, +1 or -1), or null where the
// field is too weak to have a meaningful direction.
function directionAt(p, sources, sign) {
  const [ex, ey, ez] = fieldAt(p, sources);
  const mag = Math.hypot(ex, ey, ez);
  if (!(mag > MIN_FIELD)) return null; // also catches NaN
  return [sign * ex / mag, sign * ey / mag, sign * ez / mag];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (p, d, h) => [p[0] + h * d[0], p[1] + h * d[1], p[2] + h * d[2]];

// One fourth-order Runge-Kutta step of length h along the field
// direction: sample the direction at the start, twice at the midpoint and
// once at the end, and move along their weighted average. Following a
// curve this way stays far more accurate than stepping along the starting
// direction alone, which drifts off curved lines.
function rk4Step(p, sources, sign, h) {
  const k1 = directionAt(p, sources, sign);
  if (!k1) return null;
  const k2 = directionAt(add(p, k1, h / 2), sources, sign);
  if (!k2) return null;
  const k3 = directionAt(add(p, k2, h / 2), sources, sign);
  if (!k3) return null;
  const k4 = directionAt(add(p, k3, h), sources, sign);
  if (!k4) return null;
  return [0, 1, 2].map((i) => p[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

// The first of the sinks' surfaces (shells and sheets) that a straight
// step from p along the unit direction d crosses within length h, as
// { distance, reached }: how far along it is, and whether the line
// reaches it -- whether, just short of where the step crosses it, the
// field (times sign) points into it. Null if the step crosses none.
function surfaceAhead(p, d, h, sinks, sources, sign) {
  const end = add(p, d, h);
  let first = null;
  for (const { geometry } of sinks) {
    if (!geometry.surface) continue;
    const { level, normal } = geometry.surface;
    const [g0, g1] = [level(p), level(end)];
    if (g0 < 0 === g1 < 0) continue;
    const distance = (h * g0) / (g0 - g1);
    if (first && first.distance <= distance) continue;
    const crossing = add(p, d, distance);
    const n = normal(crossing).map((c) => (g1 > g0 ? c : -c)); // along the step
    const reached = sign * dot(fieldAt(add(crossing, n, -SURFACE_OFFSET), sources), n) > 0;
    first = { distance, reached };
  }
  return first;
}

// The point straight ahead of p, along the unit direction d, where the
// field stops pointing forward along d (E . d changes sign) -- the point
// where the field vanishes that a line stopping at p was heading into --
// or null if there's none within NULL_SEARCH_DISTANCE. Found by stepping
// ahead until the sign changes, then bisecting.
//
// Finishing lines there, instead of where they stopped just short of it,
// makes lines that run into the same point from different sides actually
// meet: e.g. at the center of a square of alternating charges, or along
// the line above and below it where the field also vanishes.
function nullPointAhead(p, d, sources, sign) {
  const forward = (t) => sign * dot(fieldAt(add(p, d, t), sources), d);
  if (!(forward(0) > 0)) return null;
  for (let t = NULL_SEARCH_STEP; t <= NULL_SEARCH_DISTANCE; t += NULL_SEARCH_STEP) {
    if (forward(t) > 0) continue;
    let [a, b] = [t - NULL_SEARCH_STEP, t];
    for (let i = 0; i < 40; i++) {
      const mid = (a + b) / 2;
      if (forward(mid) > 0) a = mid;
      else b = mid;
    }
    return add(p, d, (a + b) / 2);
  }
  return null;
}

const inside = (p, half) => p.every((v) => Math.abs(v) <= half);

// Where the segment from a (inside the cube) to b (outside it) crosses
// the cube's surface.
function clipToCube(a, b, half) {
  let t = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(b[i]) > half) {
      const face = Math.sign(b[i]) * half;
      t = Math.min(t, (face - a[i]) / (b[i] - a[i]));
    }
  }
  return add(a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], t);
}

// How far either side of a surface the field is sampled, to compare it
// on the two sides.
const SURFACE_OFFSET = 1e-4;
// How close to a surface counts as on it.
const ON_SURFACE = 1e-9;

// Traces one line from `start`, along E if sign is +1, against it if -1.
// Returns { points, endsAt }, where endsAt is the index of the charge the
// line ran into, or null. startIndex is the point charge it started at,
// if any.
//
// sinks: the charged objects the line can end in -- [{ index, geometry }]
// (objectLines.js's sinkGeometry), negatively charged ones for a line
// traced along E, positive ones for a line traced against it. Their charge
// is spread out, so lines end throughout them, not at one point: as many
// end in any part of an object as that part's share of its charge. The
// line is the middle of a "flux tube", a bundle of neighboring lines with
// the same total flux, and `survival` tracks what fraction of the tube's
// flux is left:
//   - Through a volume of charge density rho, flux is absorbed at 4 pi
//     rho per unit volume (Gauss's law), and the tube's cross-section is
//     its flux / |E|, so survival falls by a factor exp(-4 pi rho h / |E|)
//     over a step of length h.
//   - Across a charged surface, the field's component along the line's
//     direction of travel drops (Gauss's law again: by 4 pi sigma), and
//     the flux that gets through is that component after the surface over
//     the one before.
// The line itself ends where survival falls below its threshold u. Lines'
// thresholds are spread evenly over 0..1 (seedDirections.js's
// seedThresholds; objectLines.js), so the fraction of lines still going
// at any point is the fraction of flux still going there.
//
// With `cut` ({ axis, offset }, a valid 2D cut), the line is held exactly
// in the cut: it starts in it, and the field there has no component across
// it, so it would stay in it anyway, but each step is put back onto it so
// rounding errors can't build up.
function traceLine(start, startIndex, sources, sign, { halfExtent, chargeRadius, cut }, sinks = [], u = 0.5) {
  const points = [start];
  let p = start;
  let length = 0;
  let previousDirection = null;
  let survival = 1;
  while (length < MAX_LINE_LENGTH) {
    const { ratio, nearest } = cancellationAndNearest(p, sources);
    if (!(ratio >= NULL_RATIO)) {
      // About to reach a point where the field vanishes: finish there.
      if (previousDirection) {
        const n = Math.hypot(...previousDirection);
        const nullPoint = nullPointAhead(p, previousDirection.map((c) => c / n), sources, sign);
        if (nullPoint) points.push(nullPoint);
      }
      break;
    }
    let h = Math.max(MIN_STEP, Math.min(MAX_STEP, STEP_PER_DISTANCE * nearest, NULL_STEP_FACTOR * ratio));
    const ahead = directionAt(p, sources, sign);
    if (!ahead) break; // the field vanished
    // A charged surface the line could end on, within a step. An RK4 step
    // would sample the field on both sides of it, and the field jumps
    // there; where it points into the surface from both sides (so the
    // surface takes in every line that reaches it), the samples' parts
    // across it cancel, and the line would skate along the surface instead
    // of reaching it. So if the line does reach it -- the field just short
    // of it points into it -- step straight to just past it, and let the
    // check below decide whether the line ends there. If not, the line
    // turns away before it: take a step short of it.
    const surface = surfaceAhead(p, ahead, h, sinks, sources, sign);
    if (surface && !surface.reached) h = Math.max(MIN_STEP, 0.9 * surface.distance);
    let next;
    let stepLength = h;
    if (surface?.reached) {
      stepLength = surface.distance + SURFACE_OFFSET;
      next = add(p, ahead, stepLength);
    } else {
      // If the field vanishes somewhere RK4 samples it -- say just past a
      // charged surface with no field beyond it, like a capacitor's plate
      // -- a plain straight step still carries the line on.
      next = rk4Step(p, sources, sign, h) ?? add(p, ahead, h);
    }
    if (cut) next[cut.axis] = cut.offset;
    // A backstop for the null-point check above: stepping past a point
    // where the field vanishes, the direction comes back reversed, and the
    // line would jitter there until the length cap. A line can't otherwise
    // reverse within one short step, so stop.
    const direction = [(next[0] - p[0]) / h, (next[1] - p[1]) / h, (next[2] - p[2]) / h];
    if (previousDirection && dot(direction, previousDirection) < 0) break;
    previousDirection = direction;
    // A step that leaves the box is cut short at the box's face first, so
    // a line ending inside an object on the way out still ends in the box.
    const leaving = !inside(next, halfExtent);
    if (leaving) {
      next = clipToCube(p, next, halfExtent);
      stepLength = Math.hypot(...sub(next, p));
    }
    for (const { index, geometry } of sinks) {
      if (geometry.line) {
        // A thin rod: lines end on its axis, like on a point charge.
        if (geometry.line.distance(next) < LINE_ROD_RADIUS) {
          points.push(geometry.line.foot(next));
          return { points, endsAt: index };
        }
      } else if (geometry.surface) {
        const { level, normal } = geometry.surface;
        const [g0, g1] = [level(p), level(next)];
        if (Math.abs(g0) < ON_SURFACE && Math.abs(g1) < ON_SURFACE) {
          // Running along the surface itself: it started on it, and
          // nothing pushes it off (the arrangement is symmetric about it).
          // If the field on both sides points into the surface, the
          // surface takes in this line's flux right here.
          const n = normal(p);
          const alongNormal = (q) => sign * dot(fieldAt(q, sources), n);
          const intoFromFront = alongNormal(add(p, n, SURFACE_OFFSET)) < 0; // on the normal's side, pointing back
          const intoFromBack = alongNormal(add(p, n, -SURFACE_OFFSET)) > 0; // on the other side, pointing at it
          if (intoFromFront && intoFromBack) {
            points.push(next);
            return { points, endsAt: index };
          }
          continue;
        }
        if (g0 < 0 === g1 < 0) continue; // didn't cross it
        const crossing = add(p, sub(next, p), g0 / (g0 - g1));
        const n = normal(crossing).map((c) => (g1 > g0 ? c : -c)); // along the line's travel
        const before = sign * dot(fieldAt(add(crossing, n, -SURFACE_OFFSET), sources), n);
        const after = sign * dot(fieldAt(add(crossing, n, SURFACE_OFFSET), sources), n);
        survival *= before > 0 ? Math.min(1, Math.max(0, after / before)) : 0;
        if (survival < u) {
          points.push(crossing);
          return { points, endsAt: index };
        }
      } else if (geometry.volume.inside(next)) {
        const strength = Math.hypot(...fieldAt(next, sources));
        survival *= Math.exp((-4 * Math.PI * geometry.volume.density * stepLength) / strength);
        if (!(survival >= u)) {
          points.push(next);
          return { points, endsAt: index };
        }
      }
    }
    if (leaving) {
      points.push(next);
      return { points, endsAt: null };
    }
    points.push(next);
    p = next;
    length += stepLength;
    // Ran into a charge? (The starting charge counts too, in case a line
    // loops back to it, but only once the line has actually left it.)
    for (let j = 0; j < sources.length; j++) {
      const s = sources[j];
      if (s.kind !== 'point') continue;
      const d = Math.hypot(p[0] - s.position[0], p[1] - s.position[1], p[2] - s.position[2]);
      if (d < chargeRadius && (j !== startIndex || length > 2 * chargeRadius)) {
        points.push(s.position); // finish at the charge's center
        return { points, endsAt: j };
      }
    }
  }
  return { points, endsAt: null };
}

// (Extra directions come in symmetric sets too: seedDirections.js's
// biggest, or in a 2D cut, 360 around a circle.)
const EXTRA_COUNT_3D = 270;
const EXTRA_COUNT_2D = 360;
// How many extra directions a short negative charge tries before giving
// up. When none of that many well-spread directions escapes, the charge's
// field comes (almost) entirely from positive charges, and more tries
// would just be slow.
const MAX_EXTRA_TRIES = 60;

const unit = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};

// sources: everything charged (see chargeTypes.js). Returns an array of
// lines, each an array of [x, y, z] points ordered in the direction of the
// field.
//
// Every unit of charge gets the same number of lines, so a point charge q
// gets N = |q| times the density setting's lines per unit charge, starting
// out in the directions of seedDirections.js's symmetric set of that size:
//   1. Each positive charge starts a line in every starting direction, and
//      each positively charged object from every one of its seeds (see
//      objectLines.js and startsAt below). Where one ends on a negative
//      point charge, the direction it arrived from is recorded.
//   2. A negative point charge that k of those lines arrived at then needs
//      N - k
//      lines of its own. Its own lines are traced backward from its
//      starting directions, and any that end on a positive charge are
//      discarded (they duplicate step 1's). It keeps as many of the rest
//      as it needs, chosen in whole orbits (sets of lines the arrangement's
//      symmetries map onto each other; symmetry.js), those spread out best
//      among the lines already touching it first. If too few remain, it
//      tries extra directions, again in orbits, farthest-first.
// This can't always come out exact. A negative charge surrounded by
// positive ones can receive more than its N lines, since each positive charge
// sends it a whole number of lines -- about N times the fraction of its
// flux that ends there -- and those roundings add up; or it can fall short
// with no line of its own able to escape. Lines are whole numbers and flux
// isn't, so with every line a true field line from evenly spread starting
// directions, a few such charges are off by a line or two. And choosing
// lines in whole orbits, so that a symmetric arrangement's picture is
// symmetric, can leave a charge a few lines over or under where the orbits
// don't add up to exactly what it needs.
//   3. A negatively charged object's own lines are traced backward from
//      its seeds, and again any that end on a positive charge (point or
//      object) are discarded. Its charge is spread out, so there's no
//      count to make up: the lines that arrive at it end throughout it in
//      proportion to its charge (traceLine), and those it adds itself come
//      from wherever no positive charge supplies them.
//
// With `cut` ({ axis, offset }, a valid 2D cut: see cutPlanes.js), only
// the lines lying in the cut are traced: starting in directions around a
// circle in it rather than over a sphere, and from the objects' seeds in
// it (cutLines.js).
// The objects a line can end in: negatively charged ones for lines traced
// along E (sign +1), positive ones for lines traced against it (-1).
function sinksFor(sources, sign) {
  return sources
    .map((source, index) => ({ index, geometry: source.kind !== 'point' && chargeSign(source) === -sign ? sinkGeometry(source) : null }))
    .filter((s) => s.geometry);
}

export function computeFieldLines(sources, { density, halfExtent, chargeRadius, cut = null }) {
  const linesPerUnitCharge = LINES_PER_UNIT_CHARGE[density - 1];
  // A point charge's starting directions and their thresholds.
  const directionsFor = (source) => {
    if (cut) return circleDirections(pointLineCount(source.q, density), cut.axis, Math.abs(source.q));
    const count = linesPerUnitCharge * Math.abs(source.q);
    return { directions: seedDirections(count), thresholds: seedThresholds(count) };
  };
  const seedsOf = (obj) => (cut ? cutObjectSeeds(obj, cut, density, halfExtent) : objectSeeds(obj, linesPerUnitCharge, halfExtent));
  const options = { halfExtent, chargeRadius, cut };

  // Every charge's seeds, each with its `orbit`: which set of seeds the
  // arrangement's symmetries map onto each other it's in (symmetry.js). A
  // point charge's seeds are its starting directions; an object's, where
  // its lines start (objectLines.js, cutLines.js). Each seed's `site` is
  // where it is, or for a seed inside a solid -- whose depth follows from
  // its threshold, so differs between mirror images -- the point on the
  // solid's surface in its direction.
  const symmetries = arrangementSymmetries(sources, cut);
  const inOrbits = (seedLists) => {
    const orbitOf = seedOrbits(seedLists.flat(), symmetries);
    let k = 0;
    return seedLists.map((list) => list.map((seed) => ({ ...seed, orbit: orbitOf[k++] })));
  };
  const tag = (seed) => (seed.dir ? 'direction' : seed.normal ? `surface${seed.layer ?? ''}` : 'volume');
  const site = (seed, source) => {
    if (seed.dir) return add(source.position, seed.dir, 1);
    if (seed.radial) return add(seed.radial.center, seed.radial.dir, seed.radial.R);
    return seed.point;
  };
  const seedsFor = inOrbits(
    sources.map((source) => {
      const list = source.kind === 'point'
        ? (({ directions, thresholds }) => directions.map((dir, k) => ({ dir, u: thresholds[k] })))(directionsFor(source))
        : seedsOf(source);
      return list.map((seed) => ({ ...seed, tag: tag(seed), site: site(seed, source) }));
    }),
  );
  // Extra directions a negative point charge can try when it's short of
  // lines (computeFieldLines' step 2), likewise in symmetric sets; worked
  // out the first time one is needed.
  let extraFor = null;
  const extraSeeds = (i) => {
    if (!extraFor) {
      const extra = cut ? circleDirections(EXTRA_COUNT_2D, cut.axis) : { directions: seedDirections(EXTRA_COUNT_3D), thresholds: seedThresholds(EXTRA_COUNT_3D) };
      extraFor = inOrbits(
        sources.map((source) => (source.kind === 'point' && source.q < 0
          ? extra.directions.map((dir, k) => ({ dir, u: extra.thresholds[k], tag: 'extra', site: add(source.position, dir, 1) }))
          : [])),
      );
    }
    return extraFor[i];
  };
  const sinks = { [+1]: sinksFor(sources, +1), [-1]: sinksFor(sources, -1) };
  const lines = [];
  // For each charge, the directions (from its center) of the lines arriving
  // at it from positive charges.
  const arrivals = sources.map(() => []);

  // Starts a line `dir` away from charge i, traced along E (sign +1) or
  // against it (-1). Each line starts at its charge's center, as lines that
  // run into a charge do at their other end; the charge's sphere hides
  // that first stretch either way.
  const trace = (i, dir, sign, u) => {
    const source = sources[i];
    const start = add(source.position, dir, chargeRadius);
    if (!inside(start, halfExtent)) return null;
    const { points, endsAt } = traceLine(start, i, sources, sign, options, sinks[sign], u);
    if (points.length < 2) return null;
    points.unshift(source.position);
    return { points, endsAt };
  };

  // Records a line traced along E from a positive charge or object: if it
  // ended on a negative point charge, where it arrived from.
  const addForwardLine = ({ points, endsAt }) => {
    lines.push(points);
    if (endsAt !== null && sources[endsAt].kind === 'point') {
      arrivals[endsAt].push(unit(sub(points[points.length - 2], sources[endsAt].position)));
    }
  };
  const endsOnPositive = (endsAt) => endsAt !== null && chargeSign(sources[endsAt]) > 0;

  // The lines starting at one of an object's seeds, traced along E (sign
  // +1, for a positive object) or against it (-1, for a negative one).
  // A volume seed starts one line, wherever the field takes it. A surface
  // seed is where the surface adds flux of its own, and that flux leaves
  // from whichever sides the field points away from the surface on (away
  // from it for a positive surface, traced along E): a and b below,
  // which add up to 4 pi |sigma|. So the seed starts a line from the
  // outer side if its threshold u is below that side's share, a / (a +
  // b), and from the inner side if u is below b / (a + b). A lone shell
  // or rod sends every line out; a lone sheet sends half each way (see
  // objectLines.js for how a sheet's seeds share that out).
  const startsAt = (seed, sign) => {
    if (!seed.normal) return [seed.point];
    const outer = add(seed.point, seed.normal, SURFACE_OFFSET);
    const inner = add(seed.point, seed.normal, -SURFACE_OFFSET);
    const a = Math.max(0, sign * dot(fieldAt(outer, sources), seed.normal));
    const b = Math.max(0, -sign * dot(fieldAt(inner, sources), seed.normal));
    if (!(a + b > 0)) return [];
    // A sheet's seeds come in two layers (objectLines.js), each with half
    // its lines, so a seed's share of a side is twice the side's share of
    // the flux, less one for the second layer.
    const share = (fraction) => (seed.layer === undefined ? fraction : 2 * fraction - seed.layer);
    const starts = [];
    if (seed.u < share(a / (a + b))) starts.push(outer);
    if (seed.u < share(b / (a + b))) starts.push(inner);
    return starts;
  };
  const traceObject = (i, sign, keep) => {
    for (const seed of seedsFor[i]) {
      for (const start of startsAt(seed, sign)) {
        if (!inside(start, halfExtent)) continue;
        const traced = traceLine(start, -1, sources, sign, options, sinks[sign], seed.u);
        if (traced.points.length < 2) continue;
        // Start exactly on the surface -- or, for a thin rod, on its axis,
        // as a point charge's lines start at its center (the rod hides
        // that first stretch).
        if (seed.normal) traced.points.unshift(seed.origin ?? seed.point);
        keep(traced);
      }
    }
  };

  sources.forEach((source, i) => {
    if (source.kind !== 'point' || !(source.q > 0)) return;
    for (const seed of seedsFor[i]) {
      const traced = trace(i, seed.dir, +1, seed.u);
      if (traced) addForwardLine(traced);
    }
  });
  sources.forEach((source, i) => {
    if (source.kind !== 'point' && chargeSign(source) > 0) traceObject(i, +1, addForwardLine);
  });

  sources.forEach((source, i) => {
    if (source.kind !== 'point' || !(source.q < 0)) return;
    const seeds = seedsFor[i];
    const needed = seeds.length - arrivals[i].length;
    if (needed <= 0) return;
    // Its own lines are chosen in whole orbits -- sets of symmetric lines,
    // all kept or none -- so a symmetric arrangement keeps its symmetry,
    // getting as close to the number needed as the orbits' sizes allow
    // (exactly, when the arrangement has no symmetry and every orbit is a
    // single line). Among the orbits whose lines all count (traced
    // backward, none ends on a positive charge), the one spread out best
    // from the lines already touching the charge goes first, and an orbit
    // that would overshoot is only taken if that ends closer to the count.
    const chosen = [];
    const taken = [...arrivals[i]];
    // Each orbit's `closest`: how near its lines come to those already
    // touching the charge -- the largest dot product of any of its
    // directions with any of theirs. The smaller, the better spread. It's
    // brought up to date with just the new lines whenever lines are taken.
    const nearer = (o, dirs) => {
      for (const m of o.members) for (const t of dirs) o.closest = Math.max(o.closest, dot(m.dir, t));
    };
    const orbitsOf = (list) => {
      const byOrbit = new Map();
      for (const seed of list) {
        if (!byOrbit.has(seed.orbit)) byOrbit.set(seed.orbit, []);
        byOrbit.get(seed.orbit).push(seed);
      }
      return [...byOrbit.entries()].map(([orbit, members]) => {
        const o = { orbit, members, closest: -Infinity };
        nearer(o, taken);
        return o;
      });
    };
    const bySpread = (a, b) => a.closest - b.closest || a.orbit - b.orbit;
    let traces = 0;
    const ownLine = (seed) => {
      traces++;
      const traced = trace(i, seed.dir, -1, seed.u);
      if (!traced || endsOnPositive(traced.endsAt)) return null;
      return { dir: seed.dir, points: traced.points };
    };
    // The orbit, given its lines, or null if they don't all count. Its
    // lines are mirror images of each other, so once one doesn't count,
    // none would, and the rest needn't be traced.
    const usable = (o) => {
      const found = [];
      for (const m of o.members) {
        const line = ownLine(m);
        if (!line) return null;
        found.push(line);
      }
      o.lines = found;
      return o;
    };
    // Whether an orbit of n lines is worth taking when the charge is
    // `missing` lines short: if they fit, or (`over`) if they overshoot by
    // less than that, ending closer to the count.
    const fits = (n, missing) => n <= missing;
    const over = (n, missing) => n - missing < missing;
    // Takes an orbit's lines, and updates how near the `others` come.
    const take = (o, others) => {
      const dirs = o.lines.map((c) => c.dir);
      chosen.push(...o.lines);
      taken.push(...dirs);
      for (const other of others) nearer(other, dirs);
    };
    let pending = orbitsOf(seeds).map(usable).filter(Boolean);
    while (chosen.length < needed && pending.length) {
      pending.sort(bySpread);
      const missing = needed - chosen.length;
      const next = pending.find((o) => fits(o.lines.length, missing)) ?? pending.find((o) => over(o.lines.length, missing));
      if (!next) break;
      pending = pending.filter((o) => o !== next);
      take(next, pending);
    }
    // Still short: try extra directions (in symmetric sets too), those
    // farthest from everything first, until MAX_EXTRA_TRIES more lines have
    // been traced.
    if (chosen.length < needed) {
      traces = 0;
      const extra = orbitsOf(extraSeeds(i));
      while (chosen.length < needed && extra.length && traces < MAX_EXTRA_TRIES) {
        extra.sort(bySpread);
        const o = usable(extra.shift());
        const missing = needed - chosen.length;
        if (o && (fits(o.lines.length, missing) || over(o.lines.length, missing))) take(o, extra);
      }
    }
    for (const c of chosen) lines.push(c.points.reverse());
  });
  sources.forEach((source, i) => {
    if (source.kind === 'point' || !(chargeSign(source) < 0)) return;
    traceObject(i, -1, ({ points, endsAt }) => {
      if (!endsOnPositive(endsAt)) lines.push(points.reverse());
    });
  });
  return lines;
}

// Positions and directions for the arrowheads along a set of lines:
// evenly spaced along each line, about one per `spacing` of length (at
// least one per line), each pointing along the line, i.e. along E.
export function arrowheadsAlong(lines, spacing) {
  const arrows = [];
  for (const points of lines) {
    // Cumulative arc length at each point.
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      cumulative.push(cumulative[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const total = cumulative[cumulative.length - 1];
    if (total === 0) continue;
    const n = Math.max(1, Math.floor(total / spacing));
    let seg = 1;
    for (let k = 0; k < n; k++) {
      const s = ((k + 0.5) / n) * total; // the middle of each of n equal stretches
      while (seg < points.length - 1 && cumulative[seg] < s) seg++;
      const [a, b] = [points[seg - 1], points[seg]];
      const len = cumulative[seg] - cumulative[seg - 1];
      if (len === 0) continue;
      const t = (s - cumulative[seg - 1]) / len;
      arrows.push({
        position: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])],
        direction: [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len],
      });
    }
  }
  return arrows;
}

// About one arrowhead per this many world units of line (FieldLines.jsx).
// Sparse on purpose: an arrowhead pointing nearly at or away from the
// viewer shows only its round cross-section, so a dense set reads as
// scattered dots.
export const ARROW_SPACING = 2;

// A set of lines packed for sending from a worker (fieldLineWorker.js):
// `segments`, every line's consecutive points as pairs -- x, y, z of one
// end, then of the other, for each little segment -- and `arrows`, each
// arrowhead's position then direction (arrowheadsAlong), six numbers each.
// Float32Arrays, so they can be handed to another thread without being
// copied.
export function packFieldLines(lines) {
  let count = 0;
  for (const line of lines) count += Math.max(0, line.length - 1);
  const segments = new Float32Array(6 * count);
  let i = 0;
  for (const line of lines) {
    for (let k = 1; k < line.length; k++) {
      segments.set(line[k - 1], i);
      segments.set(line[k], i + 3);
      i += 6;
    }
  }
  const heads = arrowheadsAlong(lines, ARROW_SPACING);
  const arrows = new Float32Array(6 * heads.length);
  heads.forEach((a, k) => {
    arrows.set(a.position, 6 * k);
    arrows.set(a.direction, 6 * k + 3);
  });
  return { segments, arrows };
}

// The arrowheads of packed lines, back as [{ position, direction }].
export function unpackArrows(arrows) {
  const out = [];
  for (let k = 0; k < arrows.length; k += 6) {
    out.push({ position: [arrows[k], arrows[k + 1], arrows[k + 2]], direction: [arrows[k + 3], arrows[k + 4], arrows[k + 5]] });
  }
  return out;
}

// The field line through a point -- a field probe's (see probes.js) --
// traced both ways from it: back against E to where it starts, and on
// along E to where it ends, as one line, ordered along E. It's the true
// field line through that point, not one of the drawn lines with its
// share of the flux, so it doesn't end partway into a charged object the
// way a drawn line can (its threshold, traceLine's u, is as low as it
// goes): only on a point charge or thin rod, on a charged surface that
// takes in everything reaching it, where the field vanishes, or at the
// box's edge. Null if it goes nowhere (the field vanishes at the point).
const TRUE_LINE_THRESHOLD = 1e-9;
export function fieldLineThrough(point, sources, { halfExtent, chargeRadius, cut = null }) {
  const options = { halfExtent, chargeRadius, cut };
  const along = traceLine(point, -1, sources, +1, options, sinksFor(sources, +1), TRUE_LINE_THRESHOLD).points;
  const against = traceLine(point, -1, sources, -1, options, sinksFor(sources, -1), TRUE_LINE_THRESHOLD).points;
  if (along.length < 2 && against.length < 2) return null;
  return [...against.reverse(), ...along.slice(1)];
}
