// How free charges move: the whole of a run, worked out in advance from
// where everything starts. Plain JS, no React or three.js, so it can be
// tested on its own.
//
// Each free charge (chargeTypes.js) is pushed by the field of every other
// charge -- pinned ones and the other free ones alike, but never its own
// -- with Newton's second law, m a = q E. The field is chargeField.js's,
// so pinned spheres, rods and planes push free charges just as they shape
// the field lines. Forces act instantly (electrostatics): at a few cm/s,
// the magnetic forces between moving charges, and the radiation from
// accelerating ones, are smaller by about (v/c)^2 ~ 1e-21. Gravity is left
// out too.
//
// A run ends at the first of:
//   - a collision: a free charge touches a wall (walls.js), whether
//     another charge or an object's surface;
//   - every free charge being outside the box at once. A free charge that
//     leaves the box isn't seen, but it keeps moving and pushing the
//     others, and it can come back in;
//   - MAX_RUN_TIME seconds.
// Nothing changes during a run, so it's computed once, in full, by
// simulateRun, and stateAt reads where everything is at any moment of it.
//
// Units: lengths in world units (1 world unit = 2 cm), time in seconds,
// charge in nC, mass in grams; velocities in world units per second.
//
// The integration is Dormand-Prince 5(4), a standard adaptive Runge-Kutta
// method: each step makes two estimates of where things will be, one
// accurate to fifth order in the step size and one to fourth, and their
// difference estimates the step's error. A step whose error is over the
// tolerance is retried shorter; after one well under it, the next step is
// longer. So steps are short where the motion changes quickly -- a close
// pass by a charge, where the force is strong and turns fast -- and long
// where it doesn't. The tolerance is tight: an ellipse around a single
// charge should close on itself lap after lap (an inverse-square force
// makes closed orbits, and a sloppy integrator would make them slowly
// turn, which is wrong physics).
import { objectField, toKilonewtonsPerCoulomb } from './chargeField.js';
import { CM } from './geometry.js';
import { WORLD_HALF_EXTENT, CHARGE_RADIUS } from './sceneConstants.js';
import { isFree } from './chargeTypes.js';
import { contactGap } from './walls.js';

export const MAX_RUN_TIME = 60; // s

// The acceleration of a free charge, per nC of charge, per gram of mass,
// per unit of chargeField.js's field, in world units per second squared:
// a = q E / m, with q in coulombs (1e-9 per nC), E in N/C, m in kg (1e-3
// per g), giving m/s^2, and one world unit being 0.01 / CM meters. About
// 1.12: two 1 nC charges 2 cm apart push a 1 g charge at 2.25 cm/s^2.
const NEWTONS_PER_COULOMB = toKilonewtonsPerCoulomb([1, 0, 0])[0] * 1000;
const METERS_PER_WORLD_UNIT = 0.01 / CM;
export const ACCELERATION_SCALE = (1e-9 * NEWTONS_PER_COULOMB) / 1e-3 / METERS_PER_WORLD_UNIT;

// The step's error tolerance, relative and absolute (world units, and
// world units per second, for positions and velocities).
const RTOL = 1e-10;
const ATOL = 1e-10;
// Steps are never longer than MAX_STEP_TIME, and never move a charge
// further than MAX_STEP_DISTANCE (half its radius), so that a collision
// can't be stepped right over, and the samples kept (one per step) trace
// its path finely enough to draw.
const MAX_STEP_TIME = 0.05;
const MAX_STEP_DISTANCE = CHARGE_RADIUS / 2;
const FIRST_STEP = 1e-3;
// A safety net: a run that takes more steps than this ends there, as if
// it had run out of time. (It shouldn't happen: walls keep charges far
// enough apart that the force stays finite.)
const MAX_STEPS = 500000;
// Bisection, finding when within a step something happened: this many
// halvings narrow it to well under a microsecond.
const BISECTIONS = 50;

// The Dormand-Prince tableau: the stage weights A -- the last row of
// which is also the fifth-order estimate's weights, so the last stage's
// slope is the next step's first ("first same as last") -- and E, the
// fifth- minus the fourth-order weights, which estimate the error. (The
// tableau's stage times aren't needed: the forces depend on where the
// charges are, not on the time.)
const A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];

// The system: its free charges, everything else (the pinned charges and
// objects, which only push), and the free charges' charge q and q/m.
// A state is a Float64Array of 6 numbers per free charge: x, y, z, then
// vx, vy, vz.
function makeSystem(charges) {
  const free = charges.filter(isFree);
  const fixed = charges.filter((c) => !isFree(c));
  return {
    free,
    fixed,
    q: free.map((c) => c.q),
    accel: free.map((c) => (ACCELERATION_SCALE * c.q) / c.mass),
  };
}

const positionOf = (y, i) => [y[6 * i], y[6 * i + 1], y[6 * i + 2]];

// The derivative of state y, into `out`: each position changes at its
// velocity, and each velocity at (q / m) E, E the field of everything but
// the charge itself.
function derivative(sys, y, out) {
  const n = sys.free.length;
  for (let i = 0; i < n; i++) {
    const p = positionOf(y, i);
    let ex = 0;
    let ey = 0;
    let ez = 0;
    for (const obj of sys.fixed) {
      const e = objectField(obj, p);
      ex += e[0];
      ey += e[1];
      ez += e[2];
    }
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = p[0] - y[6 * j];
      const dy = p[1] - y[6 * j + 1];
      const dz = p[2] - y[6 * j + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      const s = sys.q[j] / (r2 * Math.sqrt(r2));
      ex += s * dx;
      ey += s * dy;
      ez += s * dz;
    }
    const a = sys.accel[i];
    out[6 * i] = y[6 * i + 3];
    out[6 * i + 1] = y[6 * i + 4];
    out[6 * i + 2] = y[6 * i + 5];
    out[6 * i + 3] = a * ex;
    out[6 * i + 4] = a * ey;
    out[6 * i + 5] = a * ez;
  }
}

// One Dormand-Prince step of length h from state y, whose derivative k1
// is already known. Returns the fifth-order estimate, its derivative (the
// next step's k1), and the error estimate, each a new array.
function dpStep(sys, y, k1, h) {
  const m = y.length;
  const k = [k1];
  const tmp = new Float64Array(m);
  for (let s = 1; s < 7; s++) {
    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let j = 0; j < s; j++) sum += A[s][j] * k[j][i];
      tmp[i] = y[i] + h * sum;
    }
    const ks = new Float64Array(m);
    derivative(sys, tmp, ks);
    k.push(ks);
  }
  // The last stage was taken at the fifth-order estimate itself.
  const next = tmp;
  const err = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let j = 0; j < 7; j++) sum += E[j] * k[j][i];
    err[i] = h * sum;
  }
  return { next, slope: k[6], err };
}

// The error of a step from y to next, as a fraction of the tolerance
// (root mean square): a step is accepted when this is at most 1.
function errorRatio(y, next, err) {
  let sum = 0;
  for (let i = 0; i < y.length; i++) {
    const scale = ATOL + RTOL * Math.max(Math.abs(y[i]), Math.abs(next[i]));
    sum += (err[i] / scale) ** 2;
  }
  return Math.sqrt(sum / y.length);
}

function fastestSpeed(y) {
  let v = 0;
  for (let i = 0; i < y.length; i += 6) v = Math.max(v, Math.hypot(y[i + 3], y[i + 4], y[i + 5]));
  return v;
}

// The smallest gap (walls.js) between any free charge and anything else,
// in state y -- and which pair it's between: { gap, i, other }, i a free
// charge's index and `other` the charge it's closest to touching.
function closestContact(sys, y) {
  let best = { gap: Infinity, i: -1, other: null };
  const n = sys.free.length;
  for (let i = 0; i < n; i++) {
    const p = positionOf(y, i);
    for (const obj of sys.fixed) {
      const gap = contactGap(p, obj);
      if (gap < best.gap) best = { gap, i, other: obj };
    }
    for (let j = i + 1; j < n; j++) {
      const gap = contactGap(p, { kind: 'point', position: positionOf(y, j) });
      if (gap < best.gap) best = { gap, i, other: sys.free[j] };
    }
  }
  return best;
}

// Whether a point is in the box (on its surface counts as in).
export const insideBox = (p) => Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) <= WORLD_HALF_EXTENT;
function allOutside(sys, y) {
  for (let i = 0; i < sys.free.length; i++) if (insideBox(positionOf(y, i))) return false;
  return true;
}

// Within a step of length h from y (derivative k1) during which `happened`
// went from false to true: when it did, to within h / 2^BISECTIONS. Each
// trial point is a fresh single step from y, shorter than the step that
// was already accepted, so it's at least as accurate. Returns the time
// into the step just after it happened, and the state then.
function locate(sys, y, k1, h, happened) {
  let lo = 0;
  let hi = h;
  let state = dpStep(sys, y, k1, h).next;
  for (let b = 0; b < BISECTIONS; b++) {
    const mid = (lo + hi) / 2;
    const trial = dpStep(sys, y, k1, mid).next;
    if (happened(trial)) {
      hi = mid;
      state = trial;
    } else {
      lo = mid;
    }
  }
  return { dt: hi, state };
}

// The whole run, from the starting arrangement `charges` (everything
// placed; the free charges start at their positions with their
// velocities). Null if there are no free charges. Otherwise:
//   { ids, times, states, end }
// ids: the free charges' ids, in the order their numbers are kept in each
//   state (see makeSystem);
// times / states: the run, sampled at the end of every step (times[0] is
//   0, the start), each state a Float64Array as above;
// end: { time, reason, chargeId, otherId } -- reason 'collision' (free
//   charge chargeId touched otherId, a charge's id), 'left' (every free
//   charge was outside the box) or 'time' (it ran MAX_RUN_TIME seconds).
//   A run whose free charges start against a wall ends at once, at time 0.
export function simulateRun(charges, { maxTime = MAX_RUN_TIME } = {}) {
  const sys = makeSystem(charges);
  const n = sys.free.length;
  if (n === 0) return null;

  let y = new Float64Array(6 * n);
  sys.free.forEach((c, i) => {
    y.set(c.position, 6 * i);
    y.set(c.velocity ?? [0, 0, 0], 6 * i + 3);
  });
  const times = [0];
  const states = [y];
  const finish = (time, reason, contact = null) => ({
    ids: sys.free.map((c) => c.id),
    times,
    states,
    end: { time, reason, chargeId: contact ? sys.free[contact.i].id : null, otherId: contact ? contact.other.id : null },
  });

  const touching = (state) => closestContact(sys, state).gap <= 0;
  const gone = (state) => allOutside(sys, state);
  if (touching(y)) return finish(0, 'collision', closestContact(sys, y));
  if (gone(y)) return finish(0, 'left');

  let t = 0;
  let k1 = new Float64Array(6 * n);
  derivative(sys, y, k1);
  let h = FIRST_STEP;
  for (let steps = 0; steps < MAX_STEPS; steps++) {
    const speed = fastestSpeed(y);
    h = Math.min(h, MAX_STEP_TIME, speed > 0 ? MAX_STEP_DISTANCE / speed : Infinity, maxTime - t);
    const { next, slope, err } = dpStep(sys, y, k1, h);
    const ratio = errorRatio(y, next, err);
    // How much longer or shorter the next try should be: the error goes
    // as h^5, so scaling h by ratio^(-1/5) would make it just right; 0.9
    // aims a little short of that, and the change is kept within 5x.
    const factor = Math.min(5, Math.max(0.2, 0.9 * ratio ** -0.2));
    if (!(ratio <= 1)) {
      h *= Math.min(factor, 0.5);
      continue;
    }

    // An accepted step. Did a collision, or the last charge leaving the
    // box, happen during it? Then the run ends at the moment it did --
    // the earlier, if both did.
    const events = [];
    if (touching(next)) events.push({ reason: 'collision', ...locate(sys, y, k1, h, touching) });
    if (gone(next) && !gone(y)) events.push({ reason: 'left', ...locate(sys, y, k1, h, gone) });
    if (events.length > 0) {
      const first = events.reduce((a, b) => (b.dt < a.dt ? b : a));
      times.push(t + first.dt);
      states.push(first.state);
      return finish(t + first.dt, first.reason, first.reason === 'collision' ? closestContact(sys, first.state) : null);
    }

    t += h;
    y = next;
    k1 = slope;
    times.push(t);
    states.push(y);
    // (Rounding can leave t a hair short of maxTime after the last step.)
    if (t >= maxTime - 1e-9) return finish(maxTime, 'time');
    h *= factor;
  }
  return finish(t, 'time');
}

// Where each free charge is, and how fast it's going, at time t of the run
// (clamped to the run's start and end): { positions, velocities }, each a
// list of [x, y, z] in the order of run.ids. Between two samples, each
// coordinate follows the cubic that matches the position and velocity at
// both of them (Hermite interpolation) -- accurate to the integration's
// own small error, since the steps are short.
export function stateAt(run, t) {
  const { times, states } = run;
  const time = Math.min(Math.max(t, 0), run.end.time);
  // The last sample at or before `time`.
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  const n = run.ids.length;
  const read = (y) => ({
    positions: Array.from({ length: n }, (_, i) => [y[6 * i], y[6 * i + 1], y[6 * i + 2]]),
    velocities: Array.from({ length: n }, (_, i) => [y[6 * i + 3], y[6 * i + 4], y[6 * i + 5]]),
  });
  if (lo === times.length - 1) return read(states[lo]);
  const [t0, t1] = [times[lo], times[lo + 1]];
  const [y0, y1] = [states[lo], states[lo + 1]];
  const dt = t1 - t0;
  const s = (time - t0) / dt;
  // The Hermite basis functions and their derivatives (per unit of s).
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
  const h10 = s ** 3 - 2 * s ** 2 + s;
  const h01 = -2 * s ** 3 + 3 * s ** 2;
  const h11 = s ** 3 - s ** 2;
  const d00 = 6 * s ** 2 - 6 * s;
  const d10 = 3 * s ** 2 - 4 * s + 1;
  const d01 = -6 * s ** 2 + 6 * s;
  const d11 = 3 * s ** 2 - 2 * s;
  const y = new Float64Array(6 * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const [p0, v0, p1, v1] = [y0[6 * i + k], y0[6 * i + 3 + k], y1[6 * i + k], y1[6 * i + 3 + k]];
      y[6 * i + k] = h00 * p0 + h10 * dt * v0 + h01 * p1 + h11 * dt * v1;
      y[6 * i + 3 + k] = (d00 * p0 + d10 * dt * v0 + d01 * p1 + d11 * dt * v1) / dt;
    }
  }
  return read(y);
}

// The path of the run's free charge number `index` (in the order of
// run.ids), as the pieces of it inside the box -- each a list of [x, y,
// z] points, for drawing -- since a charge outside the box isn't seen.
// Where it crosses a face of the box, the piece ends (or starts) exactly
// on the face.
export function pathInsideBox(run, index) {
  const pieces = [];
  let piece = null;
  let previous = null;
  for (const y of run.states) {
    const p = [y[6 * index], y[6 * index + 1], y[6 * index + 2]];
    const inside = insideBox(p);
    if (previous && inside !== insideBox(previous)) {
      const crossing = boxCrossing(previous, p);
      if (inside) {
        piece = [crossing];
      } else {
        piece.push(crossing);
        pieces.push(piece);
        piece = null;
      }
    }
    if (inside) {
      if (!piece) piece = [];
      piece.push(p);
    }
    previous = p;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

// Where the straight segment from a to b (one inside the box, one outside)
// crosses the box's surface.
function boxCrossing(a, b) {
  const [inner, outer] = insideBox(a) ? [a, b] : [b, a];
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const p = inner.map((v, j) => v + mid * (outer[j] - v));
    if (insideBox(p)) lo = mid;
    else hi = mid;
  }
  return inner.map((v, j) => v + lo * (outer[j] - v));
}

// What a run depends on, as a string: everything's field (its kind,
// place, charge, size and shape) plus each free charge's mass and starting
// velocity. Two arrangements with the same key make the same run, so a
// run is only recomputed when this changes -- not when, say, a display
// option is checked.
export function motionKey(charges) {
  return JSON.stringify(charges.map((c) => [
    c.id, c.kind, c.position, c.q, c.lambda, c.sigma, c.radius, c.form, c.axis, c.thickness,
    isFree(c) ? [c.mass, c.velocity] : null,
  ]));
}
