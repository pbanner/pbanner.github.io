// Tests of the field's exact cancellations (src/chargeField.js's
// balancedFieldAt, which the probes, the force arrows and the grid of field
// arrows use). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldAt, balancedFieldAt } from '../src/chargeField.js';
import { probeReading } from '../src/probes.js';

// A ring of fourteen -1 nC charges on the grid around the origin, the same
// seen from the center in every direction as from the opposite one, listed
// going around it (as they'd be placed by hand).
const RING = [[3, 0], [2.5, 1.5], [1.5, 2.5], [0, 3], [-1.5, 2.5], [-2.5, 1.5], [-3, 0], [-2.5, -1.5], [-1.5, -2.5], [0, -3], [1.5, -2.5], [2.5, -1.5], [2, 2], [-2, -2]]
  .map(([x, y], k) => ({ id: k + 1, kind: 'point', q: -1, position: [x / 2, y / 2, 0] }));

test('in the middle of a symmetric ring, the field is exactly 0, in any order', (t) => {
  t.diagnostic(`added up one by one, it comes out as ${fieldAt([0, 0, 0], RING).map((v) => v.toExponential(1)).join(', ')}`);
  assert.deepStrictEqual(balancedFieldAt([0, 0, 0], RING).map(Math.abs), [0, 0, 0]);
  assert.deepStrictEqual(balancedFieldAt([0, 0, 0], [...RING].reverse()).map(Math.abs), [0, 0, 0]);
});

test('above the middle of the ring, the field points exactly straight down', () => {
  const [ex, ey, ez] = balancedFieldAt([0, 0, 1], RING);
  assert.equal(Math.abs(ex), 0);
  assert.equal(Math.abs(ey), 0);
  assert.ok(ez < 0);
});

test('a probe in the middle of the ring reads exactly 0', () => {
  const { field } = probeReading(RING, [0, 0, 0]);
  assert.equal(Math.hypot(...field), 0);
});
