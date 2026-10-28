// Pure geometry for turning 2D pointer positions into 3D scene positions.
//
// The core problem: a point on the screen doesn't pick out a point in 3D,
// it picks out a whole *ray* -- every point along the line of sight from
// the camera through that pixel. To get a single point we intersect that
// ray with some surface. Which surface we choose is what makes dragging
// feel natural:
//   - Placing a new charge: the floor (the z = 0 plane), which is drawn as
//     a grid so students can see exactly where the charge will land.
//   - Moving a charge sideways: a horizontal plane at the charge's own
//     height, so it slides at constant z and stays under the cursor.
//   - Moving a charge up/down: a vertical plane through the charge that
//     faces the camera as squarely as possible, so dragging up the screen
//     raises it.
import * as THREE from 'three';
import { WORLD_HALF_EXTENT } from './sceneConstants.js';

// Placed/dragged positions snap to multiples of this (hold Alt to bypass),
// which makes symmetric arrangements -- a dipole, a square of charges --
// easy to build exactly.
export const SNAP_STEP = 0.5;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// The ray from the camera through the given viewport (client) point.
// `rect` is the canvas's bounding rect, used to convert client pixels into
// normalized device coordinates (-1..1 across the canvas in each direction,
// with +y up), which is what Raycaster.setFromCamera expects.
export function rayFromClient(camera, rect, clientX, clientY) {
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.clone();
}

// Where the ray crosses the horizontal plane at height z, or null if it
// never does (it points away from that plane, or runs parallel to it).
export function intersectHorizontalPlane(ray, z) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  return ray.intersectPlane(plane, new THREE.Vector3());
}

// Where the ray crosses the vertical plane through `point` that faces the
// camera. The plane's normal is the horizontal part of the direction from
// `point` toward the camera. Looking straight down that part vanishes, so
// fall back to the camera's own screen-up direction (also horizontal in
// that case), which still gives a usable plane.
export function intersectVerticalPlane(ray, camera, point) {
  const normal = new THREE.Vector3().subVectors(camera.position, point);
  normal.z = 0;
  if (normal.lengthSq() < 1e-8) {
    normal.set(0, 1, 0).applyQuaternion(camera.quaternion);
    normal.z = 0;
  }
  normal.normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  return ray.intersectPlane(plane, new THREE.Vector3());
}

export function snapValue(v, step = SNAP_STEP) {
  return Math.round(v / step) * step;
}

export function isWithinFloor(x, y) {
  return Math.abs(x) <= WORLD_HALF_EXTENT && Math.abs(y) <= WORLD_HALF_EXTENT;
}

export function clampToWorld(v) {
  return Math.min(WORLD_HALF_EXTENT, Math.max(-WORLD_HALF_EXTENT, v));
}

// The charge whose sphere the ray hits first (closest to the camera), or
// null. Done with plain ray-sphere math rather than three's mesh
// raycasting, so the pointer handlers in Viewer.jsx can hit-test without
// needing references to the rendered meshes.
export function pickCharge(ray, charges, radius) {
  let best = null;
  let bestDist = Infinity;
  const sphere = new THREE.Sphere(new THREE.Vector3(), radius);
  const hit = new THREE.Vector3();
  for (const charge of charges) {
    sphere.center.set(...charge.position);
    if (!ray.intersectSphere(sphere, hit)) continue;
    const dist = hit.distanceTo(ray.origin);
    if (dist < bestDist) {
      bestDist = dist;
      best = charge;
    }
  }
  return best;
}

// The dashed coordinate guides drawn around a dragged charge at
// `position` = (x, y, z) (see ChargeMarker), as [start, end] pairs in
// world coordinates:
//   - straight down (or up) from the charge to its foot (x, y, 0) on the
//     xy plane,
//   - from the foot to (x, 0, 0) on the x axis and to (0, y, 0) on the
//     y axis,
//   - from the charge across to (0, 0, z) on the z axis.
// A guide that would have zero length -- because the charge is already on
// the plane or axis it points to -- is left out, and so is one that exactly
// repeats an earlier guide (e.g. for a charge at (0, y, 0), the guides to
// the x axis and to the z axis would both run from the charge to the
// origin), since overlapping dashed lines flicker where their dashes
// interfere.
export function chargeGuideSegments([x, y, z]) {
  const nonzero = (v) => Math.abs(v) > 1e-9;
  const charge = [x, y, z];
  const foot = [x, y, 0];
  const candidates = [];
  if (nonzero(z)) candidates.push([charge, foot]);
  if (nonzero(y)) candidates.push([foot, [x, 0, 0]]);
  if (nonzero(x)) candidates.push([foot, [0, y, 0]]);
  if (nonzero(x) || nonzero(y)) candidates.push([charge, [0, 0, z]]);
  const seen = new Set();
  return candidates.filter(([a, b]) => {
    const key = [String(a), String(b)].sort().join('|'); // same key either direction
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
