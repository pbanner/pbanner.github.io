// Where a free charge can be: never touching, or inside, anything else.
// Plain JS, no React or three.js.
//
// A free charge (chargeTypes.js) is a ball CHARGE_RADIUS across, and
// everything else in the scene is a hard wall to it: another point
// charge's ball (pinned or free), a thin rod's drawn core, and every
// sphere's, rod's and plane's surfaces. A shell is a wall from either side
// -- a free charge can be inside one, but can't get out -- while a solid
// sphere, solid rod or slab is a wall from outside, and a free charge can't
// be inside one at all. motion.js ends a run the moment a free charge
// touches a wall; App.jsx won't let an edit put one in contact with a wall
// in the first place.
//
// The measure of both is the gap: how far the free charge's surface is
// from the wall, in world units. It's positive while they're apart, 0 when
// they touch, and negative when they overlap (or the charge is inside a
// solid). It changes smoothly as the charge moves, so motion.js can find
// the moment it reaches 0.
import { CHARGE_RADIUS, LINE_ROD_DRAWN_RADIUS } from './sceneConstants.js';
import { isFree } from './chargeTypes.js';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// From p straight out to a rod's axis.
const distanceFromAxis = (p, rod) => Math.hypot(...p.map((v, k) => (k === rod.axis ? 0 : v - rod.position[k])));

// The gap between a free charge centered at p and `other`, anything placed
// (chargeTypes.js's { kind, position, ... }).
export function contactGap(p, other) {
  const r = CHARGE_RADIUS;
  switch (other.kind) {
    case 'point':
      return distance(p, other.position) - 2 * r;
    case 'sphere': {
      const d = distance(p, other.position);
      return other.form === 'shell' ? Math.abs(d - other.radius) - r : d - other.radius - r;
    }
    case 'rod': {
      const s = distanceFromAxis(p, other);
      if (other.form === 'line') return s - LINE_ROD_DRAWN_RADIUS - r;
      return other.form === 'shell' ? Math.abs(s - other.radius) - r : s - other.radius - r;
    }
    case 'plane': {
      const d = Math.abs(p[other.axis] - other.position[other.axis]);
      return other.form === 'slab' ? d - other.thickness / 2 - r : d - r;
    }
    default:
      throw new Error(`Unknown object kind: ${other.kind}`);
  }
}

// Whether `candidate` -- anything placed, as an edit would leave it --
// would put a free charge against a wall: it's free and touches one of
// `others` (everything else placed), or it touches a free one of them.
export function touchesFreeCharge(candidate, others) {
  if (isFree(candidate) && others.some((o) => contactGap(candidate.position, o) <= 0)) return true;
  return others.some((o) => isFree(o) && contactGap(o.position, candidate) <= 0);
}

// What `other` is, for a note about a free charge hitting it: "a point
// charge", "a charged rod", ... or a free charge's own name.
export function wallName(other, freeName) {
  if (isFree(other)) return freeName(other);
  return { point: 'a point charge', sphere: 'a charged sphere', rod: 'a charged rod', plane: 'a charged plane' }[other.kind];
}
