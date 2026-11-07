// Tests of the motion engine (src/motion.js) against exact textbook
// answers. Run with `npm test` (Node's built-in test runner). Each test
// reports what it compared -- the simulated value beside the exact one --
// as a diagnostic, so the output doubles as a table of how accurate the
// engine is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateRun, stateAt, pathInsideBox, ACCELERATION_SCALE as K, MAX_RUN_TIME } from '../src/motion.js';
import { CHARGE_RADIUS, WORLD_HALF_EXTENT } from '../src/sceneConstants.js';
import { CM } from '../src/geometry.js';

// Units throughout: world units (2 cm), seconds, nC and grams. K turns
// q E / m into an acceleration, so for charges q and Q, a charge of mass m
// is pulled with K q Q / (m r^2): K |q Q| / m plays the part of G M in
// the gravitational versions of these problems.
const pinned = (id, q, position) => ({ id, kind: 'point', q, position });
const free = (id, q, position, velocity = [0, 0, 0], mass = 1) => ({ id, kind: 'point', q, position, velocity, mass, free: true, freeLabel: id });
const sheet = (id, axis, at, sigma) => {
  const position = [0, 0, 0];
  position[axis] = at;
  return { id, kind: 'plane', form: 'sheet', axis, thickness: 1, position, sigma };
};
const shell = (id, radius, position, q) => ({ id, kind: 'sphere', form: 'shell', radius, position, q });

const norm = (v) => Math.hypot(...v);
const sub = (a, b) => a.map((x, k) => x - b[k]);
const CONTACT = 2 * CHARGE_RADIUS; // two point charges' centers, touching

// Checks |actual - expected| <= tolerance, and reports both.
function compare(t, what, actual, expected, tolerance) {
  const error = Math.abs(actual - expected);
  t.diagnostic(`${what}: simulated ${actual.toPrecision(10)}, exact ${expected.toPrecision(10)}, off by ${error.toExponential(1)}`);
  assert.ok(error <= tolerance, `${what}: off by ${error}, more than ${tolerance}`);
}

// Time to fall from rest at r0 to r under an inverse-square pull with
// strength mu (r'' = -mu / r^2), from energy conservation: a degenerate
// Kepler ellipse. At r = 0 it's (pi / 2) sqrt(r0^3 / (2 mu)).
function fallTime(r0, r, mu) {
  const x = r / r0;
  return Math.sqrt(r0 ** 3 / (2 * mu)) * (Math.sqrt(x * (1 - x)) + Math.acos(Math.sqrt(x)));
}

test('no free charges: no run', () => {
  assert.equal(simulateRun([pinned(1, 1, [0, 0, 0])]), null);
});

test('free fall onto an opposite charge, from rest', (t) => {
  const run = simulateRun([pinned(1, +1, [0, 0, 0]), free(2, -1, [1, 0, 0])]);
  assert.equal(run.end.reason, 'collision');
  assert.equal(run.end.chargeId, 2);
  assert.equal(run.end.otherId, 1);
  compare(t, 'time to touch (s)', run.end.time, fallTime(1, CONTACT, K), 1e-7);
  compare(t, 'distance apart then (world units)', norm(stateAt(run, run.end.time).positions[0]), CONTACT, 1e-9);
});

test('a Kepler ellipse around one opposite charge closes, lap after lap', (t) => {
  // Starting 1 world unit out at 0.85 of the circular-orbit speed, at the
  // far end of an ellipse. Vis-viva gives its semi-major axis a, Kepler's
  // third law its period, and the near end is at 2a - 1.
  const mu = K;
  const v = 0.85 * Math.sqrt(mu / 1);
  const a = 1 / (2 / 1 - v ** 2 / mu);
  const period = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
  const run = simulateRun([pinned(1, +1, [0, 0, 0]), free(2, -1, [1, 0, 0], [0, v, 0])]);
  assert.equal(run.end.reason, 'time');
  compare(t, 'run length (s)', run.end.time, MAX_RUN_TIME, 1e-9);

  // After each whole lap, it's back where it started.
  const laps = Math.floor(MAX_RUN_TIME / period);
  let worst = 0;
  for (let lap = 1; lap <= laps; lap++) worst = Math.max(worst, norm(sub(stateAt(run, lap * period).positions[0], [1, 0, 0])));
  t.diagnostic(`${laps} laps of ${period.toFixed(4)} s each: farthest from the start after a whole lap ${worst.toExponential(1)} world units (${(worst / CM * 1e4).toExponential(1)} µm)`);
  assert.ok(worst < 1e-6, `drifted ${worst} after whole laps`);

  // The nearest approach, found among the samples and refined.
  const nearest = Math.min(...run.states.map((y) => Math.hypot(y[0], y[1], y[2])));
  compare(t, 'nearest approach (world units)', nearest, 2 * a - 1, 1e-4);

  // Energy per unit mass, v^2 / 2 - mu / r, never changes.
  const energy = (y) => (y[3] ** 2 + y[4] ** 2 + y[5] ** 2) / 2 - mu / Math.hypot(y[0], y[1], y[2]);
  const e0 = energy(run.states[0]);
  const drift = Math.max(...run.states.map((y) => Math.abs(energy(y) - e0) / Math.abs(e0)));
  t.diagnostic(`energy: largest relative change over the run ${drift.toExponential(1)}`);
  assert.ok(drift < 1e-8);
});

test('head-on at a like charge: turns back at the distance energy predicts', (t) => {
  // From x = -3 at 1 world unit/s straight at a pinned +1: kinetic energy
  // runs out where v0^2 / 2 + mu / 3 = mu / r.
  const mu = K;
  const v0 = 1;
  const run = simulateRun([pinned(1, +1, [0, 0, 0]), free(2, +1, [-3, 0, 0], [v0, 0, 0])]);
  assert.equal(run.end.reason, 'left');

  // The turning point: narrow down the time of nearest approach.
  const distanceAt = (time) => norm(stateAt(run, time).positions[0]);
  let [lo, hi] = [0, run.end.time];
  for (let k = 0; k < 200; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (distanceAt(m1) < distanceAt(m2)) hi = m2;
    else lo = m1;
  }
  compare(t, 'turning point (world units)', distanceAt(lo), mu / (v0 ** 2 / 2 + mu / 3), 1e-8);

  // It leaves the box going as fast as energy says it should at x = -5.
  const end = stateAt(run, run.end.time);
  compare(t, 'where it leaves (x, world units)', end.positions[0][0], -WORLD_HALF_EXTENT, 1e-9);
  compare(t, 'speed leaving (world units/s)', norm(end.velocities[0]), Math.sqrt(v0 ** 2 + 2 * mu * (1 / 3 - 1 / 5)), 1e-8);
});

test('two free charges: momentum conserved, accelerations in the inverse ratio of the masses', (t) => {
  // +1 nC, 1 g at x = -1 and -1 nC, 3 g at x = +1, from rest, nothing
  // pinned. Total momentum stays 0, so the center of mass stays at
  // x = 0.5, and they meet there; their separation falls as one charge
  // would toward a pinned one, with mu = K |q1 q2| (1/m1 + 1/m2).
  const [m1, m2] = [1, 3];
  const run = simulateRun([free(1, +1, [-1, 0, 0], [0, 0, 0], m1), free(2, -1, [1, 0, 0], [0, 0, 0], m2)]);
  assert.equal(run.end.reason, 'collision');
  const momentum = Math.max(...run.states.map((y) => Math.abs(m1 * y[3] + m2 * y[9])));
  t.diagnostic(`momentum: largest total over the run ${momentum.toExponential(1)} g world units/s (it starts at 0)`);
  assert.ok(momentum < 1e-10);

  const mid = stateAt(run, run.end.time / 2);
  const ratio = Math.abs(mid.velocities[0][0] / mid.velocities[1][0]); // = a1/a2, from rest
  compare(t, 'speed (and so acceleration) ratio, light to heavy', ratio, m2 / m1, 1e-9);
  compare(t, 'time to touch (s)', run.end.time, fallTime(2, CONTACT, K * (1 / m1 + 1 / m2)), 1e-7);
  const end = stateAt(run, run.end.time).positions;
  compare(t, 'center of mass at the end (x, world units)', (m1 * end[0][0] + m2 * end[1][0]) / (m1 + m2), 0.5, 1e-9);
});

test('between two oppositely charged plates: a parabola, ending on a plate', (t) => {
  // Sheets at x = -3 (positive) and x = +3 (negative): between them, each
  // adds 2 pi sigma, so E = 4 pi sigma along +x, uniform. A +1 nC charge
  // launched along +y from the middle falls toward the negative plate
  // like a thrown ball: x = a t^2 / 2, y = v t.
  const sigma = 0.005; // nC/cm^2
  const accel = K * 4 * Math.PI * (sigma / CM ** 2);
  const vy = 0.5;
  const run = simulateRun([sheet(1, 0, -3, +sigma), sheet(2, 0, +3, -sigma), free(3, +1, [0, 0, 0], [0, vy, 0])]);
  assert.equal(run.end.reason, 'collision');
  assert.equal(run.end.otherId, 2);
  compare(t, 'time to reach the plate (s)', run.end.time, Math.sqrt((2 * (3 - CHARGE_RADIUS)) / accel), 1e-7);
  let worst = 0;
  for (let time = 0; time < run.end.time; time += 0.1) {
    const [x, y] = stateAt(run, time).positions[0];
    worst = Math.max(worst, Math.abs(x - (accel * time ** 2) / 2), Math.abs(y - vy * time));
  }
  t.diagnostic(`farthest from the exact parabola: ${worst.toExponential(1)} world units`);
  assert.ok(worst < 1e-9);
});

test('inside a charged shell: no field from the shell, so a straight line to its inner wall', (t) => {
  const run = simulateRun([shell(1, 3, [0, 0, 0], 2), free(2, -1, [0, 0, 0], [1, 0, 0])]);
  assert.equal(run.end.reason, 'collision');
  assert.equal(run.end.otherId, 1);
  compare(t, 'time to the inner wall (s)', run.end.time, 3 - CHARGE_RADIUS, 1e-9);
});

test('leaving the box: the run ends when the last free charge is out', (t) => {
  const run = simulateRun([free(1, +1, [0, 0, 0], [1, 0, 0])]);
  assert.equal(run.end.reason, 'left');
  compare(t, 'time to reach the face (s)', run.end.time, WORLD_HALF_EXTENT, 1e-9);
});

test('a charge can leave the box and come back, while another is still inside', (t) => {
  // A -1 nC charge orbiting a pinned +5 nC, launched from 2 world units
  // out fast enough to reach a little past the box's faces at 5. Two very
  // heavy free charges, one above the plane of the orbit and one below,
  // keep the run going while it's out: by symmetry, their pulls out of the
  // plane cancel, so the orbit stays in it. (They do pull it a little
  // inward too, so it reaches only about 5.4, not the 7 that the central
  // charge alone would send it to, and the orbit slowly turns.)
  const mu = 5 * K;
  const v = Math.sqrt(mu * (2 / 2 - 1 / 4.5));
  const run = simulateRun([
    pinned(1, +5, [0, 0, 0]),
    free(2, -1, [2, 0, 0], [0, v, 0]),
    free(3, +1, [0, 0, 4.8], [0, 0, 0], 1e6),
    free(4, +1, [0, 0, -4.8], [0, 0, 0], 1e6),
  ]);
  assert.equal(run.end.reason, 'time');
  const pieces = pathInsideBox(run, 0);
  t.diagnostic(`its path in the box: ${pieces.length} pieces (it leaves and comes back ${pieces.length - 1} times)`);
  assert.ok(pieces.length >= 2);
  const faceDistance = (p) => Math.max(...p.map(Math.abs));
  compare(t, 'where it first leaves (distance to the box face)', faceDistance(pieces[0].at(-1)), WORLD_HALF_EXTENT, 1e-9);
  compare(t, 'where it first comes back (distance to the box face)', faceDistance(pieces[1][0]), WORLD_HALF_EXTENT, 1e-9);
});

test('a free charge that starts against a wall ends the run at once', () => {
  const run = simulateRun([pinned(1, +1, [0, 0, 0]), free(2, -1, [0.2, 0, 0])]);
  assert.equal(run.end.reason, 'collision');
  assert.equal(run.end.time, 0);
});

test('three free charges and a pinned one: total energy is conserved', (t) => {
  // A tangle with no exact answer, but the energy -- every free charge's
  // kinetic energy, plus the potential energy of every pair that includes
  // a free charge (K q1 q2 / r) -- must stay put.
  const charges = [
    pinned(1, +2, [0, 0, 0]),
    free(2, -1, [2, 0, 0], [0, 0.6, 0.1]),
    free(3, -1, [-2, 0.5, 0], [0, -0.5, 0], 2),
    free(4, +1, [0, 3, 0], [0.3, 0, 0], 0.5),
  ];
  const run = simulateRun(charges);
  const frees = charges.filter((c) => c.free);
  const energy = (y) => {
    let total = 0;
    frees.forEach((c, i) => {
      const p = [y[6 * i], y[6 * i + 1], y[6 * i + 2]];
      total += (c.mass * (y[6 * i + 3] ** 2 + y[6 * i + 4] ** 2 + y[6 * i + 5] ** 2)) / 2;
      total += (K * c.q * charges[0].q) / norm(p);
      for (let j = i + 1; j < frees.length; j++) {
        total += (K * c.q * frees[j].q) / norm(sub(p, [y[6 * j], y[6 * j + 1], y[6 * j + 2]]));
      }
    });
    return total;
  };
  const e0 = energy(run.states[0]);
  const drift = Math.max(...run.states.map((y) => Math.abs(energy(y) - e0) / Math.abs(e0)));
  t.diagnostic(`ran ${run.end.time.toFixed(2)} s (${run.end.reason}) in ${run.times.length} steps; energy's largest relative change ${drift.toExponential(1)}`);
  // Close passes, where the error is largest, make this looser than the
  // single orbit's -- still far below anything visible.
  assert.ok(drift < 1e-7);
});

test('stateAt gives back the samples themselves, at their own times', () => {
  const run = simulateRun([pinned(1, +1, [0, 0, 0]), free(2, -1, [1, 0, 0], [0, 0.9, 0])]);
  for (const k of [0, 10, 100, run.times.length - 1]) {
    const { positions, velocities } = stateAt(run, run.times[k]);
    const y = run.states[k];
    assert.ok(norm(sub(positions[0], [y[0], y[1], y[2]])) < 1e-12);
    assert.ok(norm(sub(velocities[0], [y[3], y[4], y[5]])) < 1e-12);
  }
});

test('the trail up to a moment ends exactly where the charge is then', () => {
  const run = simulateRun([pinned(1, +1, [0, 0, 0]), free(2, -1, [1, 0, 0], [0, 0.9, 0])]);
  for (const time of [0.37, 1.5, 12.25]) {
    const pieces = pathInsideBox(run, 0, time);
    const last = pieces.at(-1).at(-1);
    assert.ok(norm(sub(last, stateAt(run, time).positions[0])) < 1e-12, `at ${time} s`);
  }
  // Up to the end, it's the whole path.
  assert.deepEqual(pathInsideBox(run, 0, run.end.time), pathInsideBox(run, 0));
});

// Four pinned charges at the corners of a square, (±3, ±3, 0) cm, +1 nC on
// one diagonal and -2 nC on the other, in a given order (a list of the
// corners' letters), and a free +1 nC charge in the middle, launched along
// z at `vz` world units/s from `start`.
function quadrupole(order, vz, start = [0, 0, 0]) {
  const corners = {
    a: pinned(1, +1, [1.5, 1.5, 0]),
    b: pinned(2, +1, [-1.5, -1.5, 0]),
    c: pinned(3, -2, [1.5, -1.5, 0]),
    d: pinned(4, -2, [-1.5, 1.5, 0]),
  };
  return [...order.map((k) => corners[k]), free(9, +1, start, [0, 0, vz])];
}

test('a symmetric arrangement stays exactly symmetric, whatever order its charges were placed in', (t) => {
  // In the middle of the square, the corners' sideways pulls cancel, and
  // the free charge oscillates up and down through it. The middle is
  // unstable sideways (toward the -2 nC corners: Earnshaw's theorem), so a
  // rounding error there would grow until the charge veered off; added up
  // as balancedSum adds them, the pulls cancel exactly, in any order.
  for (const vz of [0.1, 0.45, 0.9]) {
    const runs = [['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd'], ['d', 'a', 'c', 'b']].map((order) => simulateRun(quadrupole(order, vz)));
    for (const run of runs) {
      assert.equal(run.end.reason, 'time');
      assert.equal(Math.max(...run.states.map((y) => Math.hypot(y[0], y[1]))), 0);
    }
    assert.deepStrictEqual(runs[1].states, runs[0].states);
    assert.deepStrictEqual(runs[2].states, runs[0].states);
  }
  t.diagnostic('launched at 0.05, 0.225 and 0.45 world units/s, in three orders: on the axis for all 60 s, and the same run every time');
});

test('Earnshaw: nudged just off the axis, the free charge falls into a -2 nC corner', (t) => {
  // 0.01 cm (0.005 world units) toward the corner at (3, -3) cm.
  const nudge = 0.005 / Math.SQRT2;
  const run = simulateRun(quadrupole(['a', 'b', 'c', 'd'], 0.45, [nudge, -nudge, 0]));
  t.diagnostic(`${run.end.reason} with charge ${run.end.otherId} at t = ${run.end.time.toFixed(2)} s`);
  assert.equal(run.end.reason, 'collision');
  assert.equal(run.end.otherId, 3);
  assert.ok(run.end.time < 10);
});

test("a run doesn't depend on the order the charges were placed in", () => {
  const charges = [
    pinned(1, +2, [0, 0, 0]),
    pinned(2, -1, [2, 1, 0]),
    pinned(3, +1, [-1, 3, 1]),
    shell(4, 1.5, [-3, -2, 0], 1),
    free(5, -1, [1, -2, 0.5], [0.4, 0.3, 0.1]),
  ];
  const reordered = [charges[3], charges[2], charges[4], charges[0], charges[1]];
  assert.deepStrictEqual(simulateRun(reordered).states, simulateRun(charges).states);
});
