// Electric field lines for a set of point charges. Plain JS, no React or
// three.js, so it can be tested on its own (FieldLines.jsx draws them).
//
// The field is the superposition E(r) = sum_i q_i (r - r_i) / |r - r_i|^3,
// with the Coulomb constant set to 1 -- only the field's direction and
// relative strength matter for drawing lines.
//
// A field line is a curve tangent to E everywhere, so it's traced by
// repeatedly stepping a short distance along the field's direction:
//   - Each line starts on a small sphere around a charge, at one of a
//     fixed set of directions (see SEED_SETS), the same set for every
//     charge, so the number of lines leaving or entering a charge shows
//     its size (the picture Gauss's law is about).
//   - Lines from positive charges are traced along E; lines from negative
//     charges against E (and then reversed), so every returned line runs
//     in the direction of the field.
//   - A line stops when it leaves the world cube (clipped exactly at the
//     cube's face), runs into another charge, reaches a point where the
//     field vanishes, or gets implausibly long.
//   - Lines connecting a positive charge to a negative one would otherwise
//     be drawn twice, once from each end. So they're drawn only from the
//     positive end, and each negative charge adds just enough lines of its
//     own (from the cube's edge, or from a point where the field vanishes)
//     to bring it to the same count as every other unit charge -- see
//     computeFieldLines. Equal counts matter here: lines only begin and end
//     at charges, so the net number crossing any closed surface then counts
//     the charge inside it, which is Gauss's law.

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

// ---------------------------------------------------------------------
// Starting directions
//
// The picture can only be as symmetric as the starting directions. If an
// arrangement of charges looks the same after some reflection or rotation,
// its field does too -- but the drawn lines only will if each charge's
// starting directions also look the same after it. Charges snap to a cubic
// grid, so any symmetry an arrangement can have is one of the cube's 48
// (reflections across the coordinate planes, swapping axes, 90-degree
// rotations, and their combinations). So the starting directions are sets
// that all 48 leave unchanged: Lebedev grids, point sets on the sphere
// built for exactly this symmetry (originally for numerical integration),
// and spread out about as evenly as such a set can be.
//
// Each set is a union of "orbits": a direction together with every
// direction any of the 48 symmetries can turn it into, i.e. every
// permutation of its coordinates with every choice of signs.
//
// (When an arrangement's symmetry swaps positive and negative charges, as
// in a dipole or a square of alternating charges, the field on the mirror
// plane points straight through it, so every line crossing that plane is
// its own mirror image. Lines from a positive charge therefore arrive at
// the mirrored negative charge along mirrored starting directions, and
// dropping that charge's own duplicates (above) keeps the symmetry.)
function orbit(v) {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const norm = Math.hypot(...v);
  const seen = new Map();
  for (const perm of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const d = perm.map((axis, k) => ((signs >> k) & 1 ? -1 : 1) * v[axis] / norm);
      seen.set(d.map((c) => c.toFixed(9)).join(','), d.map((c) => c + 0)); // + 0 turns -0 into 0
    }
  }
  return [...seen.values()];
}

const AXES = orbit([1, 0, 0]); //                6: +/-x, +/-y, +/-z
const FACE_DIAGONALS = orbit([1, 1, 0]); //     12
const CORNERS = orbit([1, 1, 1]); //             8
// Two 24-point orbits from the 38- and 50-point Lebedev grids.
const LEBEDEV_38_C = orbit([0.4597008433809831, 0.8880738339771153, 0]);
const LEBEDEV_50_B = orbit([0.3015113445777636, 0.3015113445777636, 0.9045340337332909]);

// The density setting (1-5) picks one of these: 6, 14, 26, 38 or 50
// starting directions per unit charge.
const SEED_SETS = [
  AXES,
  [...AXES, ...CORNERS],
  [...AXES, ...FACE_DIAGONALS, ...CORNERS],
  [...AXES, ...CORNERS, ...LEBEDEV_38_C],
  [...AXES, ...FACE_DIAGONALS, ...CORNERS, ...LEBEDEV_50_B],
];
export const FIELD_LINE_DENSITY_LEVELS = SEED_SETS.length;

// sources: [{ position: [x, y, z], q }]
function fieldAt([x, y, z], sources) {
  let ex = 0;
  let ey = 0;
  let ez = 0;
  for (const { position: [sx, sy, sz], q } of sources) {
    const dx = x - sx;
    const dy = y - sy;
    const dz = z - sz;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 === 0) continue;
    const s = q / (r2 * Math.sqrt(r2));
    ex += s * dx;
    ey += s * dy;
    ez += s * dz;
  }
  return [ex, ey, ez];
}

// |E| / sum(|q_i| / r_i^2) at p -- see NULL_RATIO -- and the distance from
// p to the nearest charge.
function cancellationAndNearest(p, sources) {
  const [ex, ey, ez] = fieldAt(p, sources);
  let scale = 0;
  let nearest = Infinity;
  for (const { position: [sx, sy, sz], q } of sources) {
    const r2 = (p[0] - sx) ** 2 + (p[1] - sy) ** 2 + (p[2] - sz) ** 2;
    scale += Math.abs(q) / r2;
    nearest = Math.min(nearest, Math.sqrt(r2));
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

// Traces one line from `start`, along E if sign is +1, against it if -1.
// Returns { points, endsAt }, where endsAt is the index of the charge the
// line ran into, or null.
function traceLine(start, startIndex, sources, sign, { halfExtent, chargeRadius }) {
  const points = [start];
  let p = start;
  let length = 0;
  let previousDirection = null;
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
    const next = rk4Step(p, sources, sign, h);
    if (!next) break; // the field vanished
    // A backstop for the null-point check above: stepping past a point
    // where the field vanishes, the direction comes back reversed, and the
    // line would jitter there until the length cap. A line can't otherwise
    // reverse within one short step, so stop.
    const direction = [(next[0] - p[0]) / h, (next[1] - p[1]) / h, (next[2] - p[2]) / h];
    if (previousDirection && dot(direction, previousDirection) < 0) break;
    previousDirection = direction;
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

// sources: [{ position: [x, y, z], q }], with q = +/-1 (the only charges
// the sim has; a charge of any other size would need its own starting set
// with |q| times as many lines). Returns an array of lines, each an array
// of [x, y, z] points ordered in the direction of the field.
//
// Every unit charge gets the same number of lines, N (the size of the
// starting set):
//   1. Each positive charge starts a line in every starting direction.
//      Where one ends on a negative charge, the direction it arrived from
//      is recorded.
//   2. A negative charge that k of those lines arrived at then needs N - k
//      lines of its own. Its own lines are traced backward from its
//      starting directions, and any that end on a positive charge are
//      discarded (they duplicate step 1's). If more remain than it needs,
//      it keeps the ones spread out best among the lines already touching
//      it (farthestFrom). If too few remain, it tries extra directions,
//      farthest-first, until it has enough.
// This can't always come out exact. A negative charge surrounded by
// positive ones can receive more than N lines, since each positive charge
// sends it a whole number of lines -- about N times the fraction of its
// flux that ends there -- and those roundings add up; or it can fall short
// with no line of its own able to escape. Lines are whole numbers and flux
// isn't, so with every line a true field line from evenly spread starting
// directions, a few such charges are off by a line or two.
// When an arrangement is symmetric, exactly N - k of a negative charge's
// own lines remain (they're mirror images of the positive charges' lines;
// see the note on mirror planes above), so there's nothing to choose and
// the symmetry is kept.
export function computeFieldLines(sources, { density, halfExtent, chargeRadius }) {
  const seeds = SEED_SETS[density - 1];
  const options = { halfExtent, chargeRadius };
  const lines = [];
  // For each charge, the directions (from its center) of the lines arriving
  // at it from positive charges.
  const arrivals = sources.map(() => []);

  // Starts a line `dir` away from charge i, traced along E (sign +1) or
  // against it (-1). Each line starts at its charge's center, as lines that
  // run into a charge do at their other end; the charge's sphere hides
  // that first stretch either way.
  const trace = (i, dir, sign) => {
    const source = sources[i];
    const start = add(source.position, dir, chargeRadius);
    if (!inside(start, halfExtent)) return null;
    const { points, endsAt } = traceLine(start, i, sources, sign, options);
    if (points.length < 2) return null;
    points.unshift(source.position);
    return { points, endsAt };
  };

  sources.forEach((source, i) => {
    if (!(source.q > 0)) return;
    for (const dir of seeds) {
      const traced = trace(i, dir, +1);
      if (!traced) continue;
      const { points, endsAt } = traced;
      lines.push(points);
      if (endsAt !== null) {
        arrivals[endsAt].push(unit(sub(points[points.length - 2], sources[endsAt].position)));
      }
    }
  });

  sources.forEach((source, i) => {
    if (!(source.q < 0)) return;
    const needed = seeds.length - arrivals[i].length;
    if (needed <= 0) return;
    // Backward-traced lines that don't end on a positive charge.
    const ownLine = (dir) => {
      const traced = trace(i, dir, -1);
      if (!traced || (traced.endsAt !== null && sources[traced.endsAt].q > 0)) return null;
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
    const extra = EXTRA_DIRECTIONS.map((dir) => ({ dir }));
    for (let tries = 0; chosen.length < needed && tries < MAX_EXTRA_TRIES; tries++) {
      const { dir } = extra.splice(farthestFrom(extra, taken), 1)[0];
      const c = ownLine(dir);
      if (c) take(c);
    }
    for (const c of chosen) lines.push(c.points.reverse());
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
