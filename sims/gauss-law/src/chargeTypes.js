// What the sidebar can place, how each kind's charge is set, and their
// colors. Plain data, no React.
//
// Everything placed is { id, kind, position: [x, y, z], ... } (chargeField.js
// computes each kind's field):
//   point   { q }                            q in units of q
//   sphere  { radius, form, q }              form 'shell' or 'solid'; q is
//                                            its total charge
//   rod     { axis, radius, form, lambda }   infinite, along axis 0, 1 or
//                                            2 (x, y or z); form 'line',
//                                            'shell' or 'solid'; lambda in
//                                            q per tick of length
//   plane   { axis, thickness, form, sigma } infinite, perpendicular to
//                                            axis 0, 1 or 2; form 'sheet'
//                                            or 'slab'; sigma in q per
//                                            tick^2 of area
// Lengths (position, radius, thickness) are in world units, like every
// position in the scene; the properties panel shows them in ticks. A rod's
// position is where its axis crosses the plane perpendicular to it (the
// axis coordinate is always 0), and a plane's is where it crosses its
// axis (the other two coordinates are always 0).
export const MAX_CHARGE_STEPS = 5;

// Each kind's charge comes in whole steps, from -MAX_CHARGE_STEPS to
// +MAX_CHARGE_STEPS but never 0 (no charge at all). Rods and planes are
// infinite, so their charge is set as a density; its step is chosen so
// the part of the rod (20 ticks long) or plane (20 x 20 ticks) inside the
// box holds a whole number of q: 1 q per step for a rod, 2 q for a plane.
// Field lines are drawn in proportion to charge, so that keeps their
// counts whole.
export const CHARGE_SETTINGS = {
  point: { key: 'q', step: 1, unit: 'q' },
  sphere: { key: 'q', step: 1, unit: 'q' },
  rod: { key: 'lambda', step: 0.05, unit: 'q/tick' },
  plane: { key: 'sigma', step: 0.005, unit: 'q/tick²' },
};

// A charge's setting in whole steps (+3, -1, ...), and a copy of it with
// a different number of steps.
export function chargeSteps(charge) {
  const { key, step } = CHARGE_SETTINGS[charge.kind];
  return Math.round(charge[key] / step);
}
export function withChargeSteps(charge, steps) {
  const { key, step } = CHARGE_SETTINGS[charge.kind];
  return { ...charge, [key]: steps * step };
}
export function chargeSign(charge) {
  return Math.sign(charge[CHARGE_SETTINGS[charge.kind].key]);
}

const POSITIVE_COLOR = '#d63a3a';
const NEGATIVE_COLOR = '#2f6fd6';

// Red for positive, blue for negative. Takes a number (a point charge's q)
// or anything placed.
export function chargeColor(chargeOrQ) {
  const sign = typeof chargeOrQ === 'number' ? Math.sign(chargeOrQ) : chargeSign(chargeOrQ);
  return sign > 0 ? POSITIVE_COLOR : NEGATIVE_COLOR;
}

// "+3", "−2" (a true minus sign), or just "+" / "−" for a unit charge.
export function chargeSignText(q) {
  const sign = q > 0 ? '+' : '−';
  return Math.abs(q) === 1 ? sign : `${sign}${Math.abs(q)}`;
}

// The sidebar's buttons. A new point charge is +1 or -1; a new object is
// positively charged, one step's worth, sized and turned as below
// (lengths in world units: 1 world unit is 2 ticks).
export const CHARGE_TYPES = [
  { id: 'positive', label: 'Positive Charge', kind: 'point', defaults: { q: +1 } },
  { id: 'negative', label: 'Negative Charge', kind: 'point', defaults: { q: -1 } },
  { id: 'sphere', label: 'Charged Sphere', kind: 'sphere', defaults: { radius: 1, form: 'shell', q: 1 } },
  { id: 'rod', label: 'Charged Rod', kind: 'rod', defaults: { axis: 2, radius: 0.5, form: 'line', lambda: 0.05 } },
  { id: 'plane', label: 'Charged Plane', kind: 'plane', defaults: { axis: 0, thickness: 1, form: 'sheet', sigma: 0.005 } },
];

export function getChargeType(id) {
  return CHARGE_TYPES.find((t) => t.id === id);
}

// A new charge of the given sidebar type dropped at `point` (no id yet).
// A rod goes through the point along its axis (a new rod is vertical, so
// through the point on the floor); a plane goes through it perpendicular
// to its axis. `adjust` can change it first, e.g. turning it to fit a 2D
// cut (cutPlanes.js's keepInCut), before its position is normalized.
export function makeCharge(typeId, point, adjust = (c) => c) {
  const type = getChargeType(typeId);
  return normalizePosition(adjust({ kind: type.kind, position: point, ...type.defaults }));
}

// A rod's or plane's position with the coordinates that don't matter set
// to 0 (see the top of this file). Points and spheres are unchanged.
export function normalizePosition(charge) {
  if (charge.kind === 'rod') {
    const position = [...charge.position];
    position[charge.axis] = 0;
    return { ...charge, position };
  }
  if (charge.kind === 'plane') {
    const position = [0, 0, 0];
    position[charge.axis] = charge.position[charge.axis];
    return { ...charge, position };
  }
  return charge;
}
