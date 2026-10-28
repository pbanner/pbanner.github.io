// Electric field lines for a set of point charges. Plain JS, no React or
// three.js, so it can be tested on its own (FieldLines.jsx draws them).
//
// The field is the superposition E(r) = sum_i q_i (r - r_i) / |r - r_i|^3,
// with the Coulomb constant set to 1 -- only the field's direction and
// relative strength matter for drawing lines.
//
// A field line is a curve tangent to E everywhere, so it's traced by
// repeatedly stepping a short distance along the field's direction:
//   - Each line starts on a small sphere around a charge. The starting
//     points are spread evenly over that sphere, and their number is
//     proportional to |q|, so the number of lines leaving or entering a
//     charge shows its size (the picture Gauss's law is about).
//   - Lines from positive charges are traced along E; lines from negative
//     charges against E (and then reversed), so every returned line runs
//     in the direction of the field.
//   - A line stops when it leaves the world cube (clipped exactly at the
//     cube's face), runs into another charge, stalls where the field
//     vanishes, or gets implausibly long.
//   - Lines connecting a positive charge to a negative one would otherwise
//     be drawn twice, once from each end. So a line traced from a negative
//     charge is dropped if it ends on a positive charge -- the positive
//     charge's own lines already cover those connections -- and negative
//     charges keep only their lines that run off to the cube's edge.

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

// Lines per unit charge for the Display Options slider's density setting.
export function linesPerUnitChargeForDensity(density) {
  return 4 * density;
}

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

// The unit vector along E (times `sign`, +1 or -1), or null where the
// field is too weak to have a meaningful direction.
function directionAt(p, sources, sign) {
  const [ex, ey, ez] = fieldAt(p, sources);
  const mag = Math.hypot(ex, ey, ez);
  if (!(mag > MIN_FIELD)) return null; // also catches NaN
  return [sign * ex / mag, sign * ey / mag, sign * ez / mag];
}

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
  while (length < MAX_LINE_LENGTH) {
    let nearest = Infinity;
    for (const s of sources) {
      nearest = Math.min(nearest, Math.hypot(p[0] - s.position[0], p[1] - s.position[1], p[2] - s.position[2]));
    }
    const h = Math.min(MAX_STEP, Math.max(MIN_STEP, STEP_PER_DISTANCE * nearest));
    const next = rk4Step(p, sources, sign, h);
    if (!next) break; // the field vanished
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
// each time, so no two points line up.
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

// sources: [{ position: [x, y, z], q }]. Returns an array of lines, each
// an array of [x, y, z] points ordered in the direction of the field.
export function computeFieldLines(sources, { linesPerUnitCharge, halfExtent, chargeRadius }) {
  const lines = [];
  sources.forEach((source, i) => {
    if (source.q === 0) return;
    const sign = Math.sign(source.q);
    const count = Math.round(linesPerUnitCharge * Math.abs(source.q));
    for (const dir of fibonacciSphere(count)) {
      const start = add(source.position, dir, chargeRadius);
      if (!inside(start, halfExtent)) continue;
      const { points, endsAt } = traceLine(start, i, sources, sign, { halfExtent, chargeRadius });
      if (points.length < 2) continue;
      if (sign < 0) {
        if (endsAt !== null && sources[endsAt].q > 0) continue; // already drawn from the positive end
        points.reverse();
      }
      lines.push(points);
    }
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
