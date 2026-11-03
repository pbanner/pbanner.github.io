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

// The units shown and typed everywhere: lengths in centimeters, one grid
// spacing (SNAP_STEP world units) being 1 cm, and charge in nanocoulombs
// (nC). Positions in the scene stay in world units (1 world unit = 2 cm);
// CM converts: a length in cm times CM is in world units.
export const CM = SNAP_STEP;

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
  return intersectAxisPlane(ray, 2, z);
}

// The same for any plane perpendicular to an axis (0, 1 or 2): where the
// ray crosses the plane where that coordinate is `value`.
export function intersectAxisPlane(ray, axis, value) {
  const normal = new THREE.Vector3().setComponent(axis, 1);
  return ray.intersectPlane(new THREE.Plane(normal, -value), new THREE.Vector3());
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

// The charged sphere, rod or plane (see chargeTypes.js) the ray hits first,
// or null. Like pickCharge, plain geometry rather than mesh raycasting.
// Rods and planes are drawn across the whole box, so they can only be hit
// inside it. A thin rod (form 'line') is hit within LINE_ROD_PICK_RADIUS
// of its axis -- wider than it's drawn, so it isn't fiddly to click.
const LINE_ROD_PICK_RADIUS = 0.15;
export function pickObject(ray, objects) {
  let best = null;
  let bestDist = Infinity;
  for (const obj of objects) {
    const dist = rayHitDistance(ray, obj);
    if (dist !== null && dist < bestDist) {
      bestDist = dist;
      best = obj;
    }
  }
  return best;
}

const H = WORLD_HALF_EXTENT;

// How far along the ray it first hits the object, or null if it misses.
function rayHitDistance(ray, obj) {
  const o = ray.origin.toArray();
  const d = ray.direction.toArray();
  const c = obj.position;
  if (obj.kind === 'sphere') {
    const hit = ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(...c), obj.radius), new THREE.Vector3());
    return hit ? hit.distanceTo(ray.origin) : null;
  }
  if (obj.kind === 'rod') {
    // The rod as it's drawn: a cylinder across the box, ending at two of
    // its faces. A ray can enter it through its side -- where, seen along
    // the rod's axis (where it's a circle), it crosses the circle: solve
    // |(o - c) + t d|^2 = R^2 using only the other two coordinates -- or
    // through one of its ends, at a face of the box: looking along the
    // rod, as the 2D cut's view does at a rod crossing it, the only way in.
    const R = obj.form === 'line' ? LINE_ROD_PICK_RADIUS : obj.radius;
    const [u, v] = [0, 1, 2].filter((k) => k !== obj.axis);
    const ou = o[u] - c[u];
    const ov = o[v] - c[v];
    const a = d[u] * d[u] + d[v] * d[v];
    const b = 2 * (ou * d[u] + ov * d[v]);
    const cc = ou * ou + ov * ov - R * R;
    const disc = b * b - 4 * a * cc;
    const hits = [];
    if (a > 0 && disc >= 0) {
      for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) {
        if (t > 0 && Math.abs(o[obj.axis] + t * d[obj.axis]) <= H) hits.push(t);
      }
    }
    if (d[obj.axis] !== 0) {
      for (const end of [-H, H]) {
        const t = (end - o[obj.axis]) / d[obj.axis];
        const [pu, pv] = [ou + t * d[u], ov + t * d[v]];
        if (t > 0 && pu * pu + pv * pv <= R * R) hits.push(t);
      }
    }
    return hits.length ? Math.min(...hits) : null;
  }
  if (obj.kind === 'plane') {
    const min = [-H, -H, -H];
    const max = [H, H, H];
    const half = obj.form === 'slab' ? obj.thickness / 2 : 0;
    min[obj.axis] = c[obj.axis] - half;
    max[obj.axis] = c[obj.axis] + half;
    if (half === 0) {
      // A sheet has no thickness: where the ray crosses its plane.
      if (d[obj.axis] === 0) return null;
      const t = (c[obj.axis] - o[obj.axis]) / d[obj.axis];
      if (!(t > 0)) return null;
      const hit = o.map((x, k) => x + t * d[k]);
      return hit.every((x, k) => k === obj.axis || Math.abs(x) <= H) ? t : null;
    }
    const hit = ray.intersectBox(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), new THREE.Vector3());
    return hit ? hit.distanceTo(ray.origin) : null;
  }
  return null;
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
  //if (nonzero(x) || nonzero(y)) candidates.push([charge, [0, 0, z]]);
  const seen = new Set();
  return candidates.filter(([a, b]) => {
    const key = [String(a), String(b)].sort().join('|'); // same key either direction
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The same for a charged sphere, rod or plane (or the 2D cut, { kind:
// 'cut', axis, offset }) being dragged -- guides only for the coordinates
// it can change. A sphere's are a point charge's, from its center. A rod's
// position is where its axis crosses the plane across it through the
// origin, and it gets a guide from there to each of the two axes in that
// plane (for a vertical rod: from where it meets the floor to the x and y
// axes). A plane's is one from the origin along its normal to it. As
// above, a guide of zero length is left out.
export function objectGuideSegments(obj) {
  if (obj.kind === 'sphere') return chargeGuideSegments(obj.position);
  const nonzero = (v) => Math.abs(v) > 1e-9;
  if (obj.kind === 'rod') {
    const p = obj.position;
    return [0, 1, 2].filter((k) => k !== obj.axis && nonzero(p[k])).map((k) => {
      const onAxis = [...p];
      onAxis[k] = 0;
      return [p, onAxis];
    });
  }
  if (obj.kind === 'plane' || obj.kind === 'cut') {
    const value = obj.kind === 'cut' ? obj.offset : obj.position[obj.axis];
    if (!nonzero(value)) return [];
    const foot = [0, 0, 0];
    foot[obj.axis] = value;
    return [[[0, 0, 0], foot]];
  }
  return [];
}
