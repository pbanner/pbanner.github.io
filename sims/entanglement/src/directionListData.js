// The single, shared list of analyzer directions -- kept independent of both
// Source (any source type can have its steppers "follow" it) and Data
// Collection mode (Fixed cycles through it one at a time; Random choice
// samples from it per pair) -- see directionList.jsx for the UI and
// physics.js's "Hidden instruction sets" section for how the Hidden
// Instruction Sets source, specifically, reads directions from this same
// list rather than keeping its own copy. A direction is
// { id, thetaDeg, phiDeg }, always whole degrees -- both this sim's own
// display precision for these, and what lets an analyzer's current
// [theta, phi] radians be matched back to "which direction is this" exactly
// (physics.js's findInstructionColumnIndex) rather than comparing floats.

export const MAX_DIRECTIONS = 4;

let directionIdCounter = 0;
function nextDirectionId() {
  directionIdCounter += 1;
  return `dir-${directionIdCounter}`;
}

// A fresh single-direction list (Z) -- the minimal starting point.
export function createInitialDirectionList() {
  return [{ id: nextDirectionId(), thetaDeg: 0, phiDeg: 0 }];
}

export function addDirection(list) {
  if (list.length >= MAX_DIRECTIONS) return list;
  return [...list, { id: nextDirectionId(), thetaDeg: 0, phiDeg: 0 }];
}

// The list must never go empty -- both the Fixed-mode stepper and Random
// choice's per-side sampling always need at least one direction to point at.
export function deleteDirection(list, directionId) {
  if (list.length <= 1) return list;
  return list.filter((d) => d.id !== directionId);
}

export function editDirection(list, directionId, thetaDeg, phiDeg) {
  return list.map((d) => (d.id === directionId ? { ...d, thetaDeg, phiDeg } : d));
}
