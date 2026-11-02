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
    const h = Math.max(MIN_STEP, Math.min(MAX_STEP, STEP_PER_DISTANCE * nearest, NULL_STEP_FACTOR * ratio));
    // If the field vanishes somewhere RK4 samples it -- say just past a
    // charged surface with no field beyond it, like a capacitor's plate --
    // a plain straight step still carries the line across, so it can end
    // on that surface (below).
    let next = rk4Step(p, sources, sign, h);
    if (!next) {
      const d = directionAt(p, sources, sign);
      if (!d) break; // the field vanished
      next = add(p, d, h);
    }
    if (cut) next[cut.axis] = cut.offset;
    // A backstop for the null-point check above: stepping past a point
    // where the field vanishes, the direction comes back reversed, and the
    // line would jitter there until the length cap. A line can't otherwise
    // reverse within one short step, so stop.
    const direction = [(next[0] - p[0]) / h, (next[1] - p[1]) / h, (next[2] - p[2]) / h];
    if (previousDirection && dot(direction, previousDirection) < 0) break;
    previousDirection = direction;
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
        survival *= Math.exp((-4 * Math.PI * geometry.volume.density * h) / strength);
        if (!(survival >= u)) {
          points.push(next);
          return { points, endsAt: index };
        }
      }
    }
    if (!inside(next, halfExtent)) {
      points.push(clipToCube(p, next, halfExtent));
      return { points, endsAt: null };
    }
    points.push(next);
    p = next;
    length += h;
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

// n points spread almost evenly over the unit sphere: a "Fibonacci
// sphere", which steps evenly in height while turning by the golden angle
// each time. Only used for extra starting directions at a negative charge
// that's short of lines (see computeFieldLines), which happens only when
// the arrangement has no symmetry to preserve.
function fibonacciSphere(n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    dirs.push([r * Math.cos(golden * i), r * Math.sin(golden * i), z]);
  }
  return dirs;
}
const EXTRA_DIRECTIONS = fibonacciSphere(400);
// The same for a point charge in a 2D cut: directions around a circle in
// it.
const EXTRA_CIRCLE_DIRECTIONS = (axis) => circleDirections(360, axis).directions;
// How many extra directions a short negative charge tries before giving
// up. When none of that many well-spread directions escapes, the charge's
// field comes (almost) entirely from positive charges, and more tries
// would just be slow.
const MAX_EXTRA_TRIES = 60;

const unit = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};

// Of `candidates` (each with a unit .dir), the index of the one whose
// direction is farthest, by angle, from every direction in `taken` -- the
// largest dot product with any of them being the smallest. Repeatedly
// taking that one ("farthest-point selection") spreads the picks out as
// evenly as the candidates allow.
function farthestFrom(candidates, taken) {
  let best = -1;
  let bestClosest = Infinity;
  candidates.forEach((c, i) => {
    let closest = -Infinity;
    for (const t of taken) closest = Math.max(closest, dot(c.dir, t));
    if (closest < bestClosest) {
      bestClosest = closest;
      best = i;
    }
  });
  return best;
}

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
//      discarded (they duplicate step 1's). If more remain than it needs,
//      it keeps the ones spread out best among the lines already touching
//      it (farthestFrom). If too few remain, it tries extra directions,
//      farthest-first, until it has enough.
// This can't always come out exact. A negative charge surrounded by
// positive ones can receive more than its N lines, since each positive charge
// sends it a whole number of lines -- about N times the fraction of its
// flux that ends there -- and those roundings add up; or it can fall short
// with no line of its own able to escape. Lines are whole numbers and flux
// isn't, so with every line a true field line from evenly spread starting
// directions, a few such charges are off by a line or two.
// When an arrangement is symmetric, exactly N - k of a negative charge's
// own lines remain (they're mirror images of the positive charges' lines;
// see the note on mirror planes above), so there's nothing to choose and
// the symmetry is kept.
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
export function computeFieldLines(sources, { density, halfExtent, chargeRadius, cut = null }) {
  const linesPerUnitCharge = LINES_PER_UNIT_CHARGE[density - 1];
  // A point charge's starting directions and their thresholds.
  const directionsFor = (source) => {
    if (cut) return circleDirections(pointLineCount(source.q, density), cut.axis);
    const count = linesPerUnitCharge * Math.abs(source.q);
    return { directions: seedDirections(count), thresholds: seedThresholds(count) };
  };
  const seedsOf = (obj) => (cut ? cutObjectSeeds(obj, cut, density, halfExtent) : objectSeeds(obj, linesPerUnitCharge, halfExtent));
  const extraDirections = cut ? EXTRA_CIRCLE_DIRECTIONS(cut.axis) : EXTRA_DIRECTIONS;
  const options = { halfExtent, chargeRadius, cut };
  // The objects a line can end in: negatively charged ones for lines
  // traced along E, positive ones for lines traced against it.
  const sinksFor = (sign) => sources
    .map((source, index) => ({ index, geometry: source.kind !== 'point' && chargeSign(source) === -sign ? sinkGeometry(source) : null }))
    .filter((s) => s.geometry);
  const sinks = { [+1]: sinksFor(+1), [-1]: sinksFor(-1) };
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
  // or rod sends every line out; a lone sheet sends half each way, from
  // the same points on both sides (those with u < 1/2).
  const startsAt = (seed, sign) => {
    if (!seed.normal) return [seed.point];
    const outer = add(seed.point, seed.normal, SURFACE_OFFSET);
    const inner = add(seed.point, seed.normal, -SURFACE_OFFSET);
    const a = Math.max(0, sign * dot(fieldAt(outer, sources), seed.normal));
    const b = Math.max(0, -sign * dot(fieldAt(inner, sources), seed.normal));
    if (!(a + b > 0)) return [];
    const starts = [];
    if (seed.u < a / (a + b)) starts.push(outer);
    if (seed.u < b / (a + b)) starts.push(inner);
    return starts;
  };
  const traceObject = (i, sign, keep) => {
    for (const seed of seedsOf(sources[i])) {
      for (const start of startsAt(seed, sign)) {
        if (!inside(start, halfExtent)) continue;
        const traced = traceLine(start, -1, sources, sign, options, sinks[sign], seed.u);
        if (traced.points.length < 2) continue;
        if (seed.normal) traced.points.unshift(seed.point); // start exactly on the surface
        keep(traced);
      }
    }
  };

  sources.forEach((source, i) => {
    if (source.kind !== 'point' || !(source.q > 0)) return;
    const { directions, thresholds: us } = directionsFor(source);
    directions.forEach((dir, k) => {
      const traced = trace(i, dir, +1, us[k]);
      if (traced) addForwardLine(traced);
    });
  });
  sources.forEach((source, i) => {
    if (source.kind !== 'point' && chargeSign(source) > 0) traceObject(i, +1, addForwardLine);
  });

  sources.forEach((source, i) => {
    if (source.kind !== 'point' || !(source.q < 0)) return;
    const { directions: seeds, thresholds: us } = directionsFor(source);
    const needed = seeds.length - arrivals[i].length;
    if (needed <= 0) return;
    // Backward-traced lines that don't end on a positive charge.
    const ownLine = (dir, k) => {
      const traced = trace(i, dir, -1, k === undefined ? 0.5 : us[k]);
      if (!traced || endsOnPositive(traced.endsAt)) return null;
      return { dir, points: traced.points };
    };
    let candidates = seeds.map(ownLine).filter(Boolean);
    const chosen = [];
    const taken = [...arrivals[i]];
    const take = (c) => {
      chosen.push(c);
      taken.push(c.dir);
    };
    if (candidates.length <= needed) {
      candidates.forEach(take);
    } else {
      while (chosen.length < needed) take(candidates.splice(farthestFrom(candidates, taken), 1)[0]);
    }
    // Still short: try extra directions, farthest from everything first.
    const extra = extraDirections.map((dir) => ({ dir }));
    for (let tries = 0; chosen.length < needed && tries < MAX_EXTRA_TRIES; tries++) {
      const { dir } = extra.splice(farthestFrom(extra, taken), 1)[0];
      const c = ownLine(dir);
      if (c) take(c);
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
