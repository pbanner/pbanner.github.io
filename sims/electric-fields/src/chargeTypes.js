// What the sidebar can place, how each kind's charge is set, and their
// colors. Plain data, no React.
//
// Everything placed is { id, kind, position: [x, y, z], ... } (chargeField.js
// computes each kind's field):
//   point   { q }                            q in nC
//   sphere  { radius, form, q }              form 'shell' or 'solid'; q is
//                                            its total charge, in nC
//   rod     { axis, radius, form, lambda }   infinite, along axis 0, 1 or
//                                            2 (x, y or z); form 'line',
//                                            'shell' or 'solid'; lambda in
//                                            nC per cm of length
//   plane   { axis, thickness, form, sigma } infinite, perpendicular to
//                                            axis 0, 1 or 2; form 'sheet'
//                                            or 'slab'; sigma in nC per
//                                            cm^2 of area
// Lengths (position, radius, thickness) are in world units, like every
// position in the scene; the properties panel shows them in cm (see
// geometry.js's CM). A rod's
// position is where its axis crosses the plane perpendicular to it (the
// axis coordinate is always 0), and a plane's is where it crosses its
// axis (the other two coordinates are always 0).
//
// A point charge is either pinned -- held in place, the kind there always
// was -- or free: it moves, pushed by every other charge's field (see
// motion.js). A free one also has
//   { free: true, mass, velocity, freeLabel,
//     showPath, showPredictedPath, showVelocity, showForce }
// mass in grams, velocity in world units per second (its initial velocity;
// the properties panel shows cm/s), freeLabel the n in its name, q_n
// (freeLabelText), and the display options set in its panel: its trail
// during a run (on to start with), its predicted path, and arrows along its
// velocity and the force on it. A pinned
// one has free false, or no `free` at all. Switching a free charge back to
// pinned keeps its mass, velocity and display options, so switching it to
// free again brings them back, but gives up its name for another free
// charge to take.
export const MAX_CHARGE_STEPS = 5;

// Each kind's charge comes in whole steps, from -MAX_CHARGE_STEPS to
// +MAX_CHARGE_STEPS but never 0 (no charge at all). Rods and planes are
// infinite, so their charge is set as a density; its step is chosen so
// the part of the rod (20 cm long) or plane (20 x 20 cm) inside the box
// holds a whole number of nC: 1 nC per step for a rod, 2 nC for a plane.
// Field lines are drawn in proportion to charge, so that keeps their
// counts whole.
export const CHARGE_SETTINGS = {
  point: { key: 'q', step: 1, unit: 'nC' },
  sphere: { key: 'q', step: 1, unit: 'nC' },
  rod: { key: 'lambda', step: 0.05, unit: 'nC/cm' },
  plane: { key: 'sigma', step: 0.005, unit: 'nC/cm²' },
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
// (lengths in world units: 1 world unit is 2 cm).
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

// Free charges (see the top of this file). A new free charge weighs
// DEFAULT_FREE_MASS grams and starts at rest.
export const DEFAULT_FREE_MASS = 1;
export const isFree = (charge) => charge.kind === 'point' && charge.free === true;

// A free charge's name, q_n with n as subscript digits: "q₁", "q₁₂".
const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
export const freeLabelText = (n) => `q${[...String(n)].map((d) => SUBSCRIPT_DIGITS[Number(d)]).join('')}`;

// The smallest n no free charge among `charges` has, so freeing a charge
// after q₂ was pinned again brings q₂ back.
export function nextFreeLabel(charges) {
  let n = 1;
  while (charges.some((c) => isFree(c) && c.freeLabel === n)) n++;
  return n;
}

// The changes that make the point charge `charge` free, among all the
// `charges` (it among them), or pinned again.
export function freeingChanges(charge, charges) {
  return {
    free: true,
    freeLabel: nextFreeLabel(charges.filter((c) => c.id !== charge.id)),
    mass: charge.mass ?? DEFAULT_FREE_MASS,
    velocity: charge.velocity ?? [0, 0, 0],
    showPath: charge.showPath ?? true,
    showPredictedPath: charge.showPredictedPath ?? false,
    showVelocity: charge.showVelocity ?? false,
    showForce: charge.showForce ?? false,
  };
}
export const PINNING_CHANGES = { free: false, freeLabel: null };

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

// Point charges can't be stacked: a point charge can't be closer than
// MIN_SEPARATION (two charge radii) to another point charge or to a thin
// rod's axis. Two charges in one spot draw as one marker, and their lines
// run straight into each other (a +2 and a -1 together drew the lines of
// a +2, not of the +1 they add up to). Whether `candidate` would be too
// close to any of `others` (the other charges; the candidate itself left
// out):
const MIN_SEPARATION = 0.3;
const distanceToRodAxis = (p, rod) => Math.hypot(...p.map((v, k) => (k === rod.axis ? 0 : v - rod.position[k])));
const isLineRod = (c) => c.kind === 'rod' && c.form === 'line';
export function crowds(candidate, others) {
  const near = (a, b) => {
    if (a.kind === 'point' && b.kind === 'point') return Math.hypot(...a.position.map((v, k) => v - b.position[k])) < MIN_SEPARATION;
    if (a.kind === 'point' && isLineRod(b)) return distanceToRodAxis(a.position, b) < MIN_SEPARATION;
    if (isLineRod(a) && b.kind === 'point') return distanceToRodAxis(b.position, a) < MIN_SEPARATION;
    return false;
  };
  return others.some((o) => near(candidate, o));
}
