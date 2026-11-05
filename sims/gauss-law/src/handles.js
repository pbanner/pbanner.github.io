// The handles on a selected charged sphere, rod or slab, which change its
// size -- its position changes by dragging the object itself (Viewer.jsx)
// -- and the drag along a line that they, and dragging a plane, use.
// Plain JS (three.js math only, no React); ObjectHandles.jsx draws them
// and Viewer.jsx picks and drags them.
//
// Each handle is { id, position, direction }:
//   'radius'    on a sphere's or rod's surface, on the side facing the
//               camera's right: drags the radius.
//   'thickness' on a slab's face: drags the face out or in, the other
//               face following, so the slab stays centered.
// `direction` is the line the handle moves along. Where they are depends
// on the camera (they sit on the side facing it), so they're recomputed
// whenever it moves.
import * as THREE from 'three';
import { snapValue } from './geometry.js';

// How far along a slab from its middle the thickness handle sits.
const THICKNESS_HANDLE_OFFSET = 1.5;

export const unitAxis = (axis) => [0, 1, 2].map((k) => (k === axis ? 1 : 0));
const add = (p, d, s) => p.map((v, k) => v + s * d[k]);

// The camera's screen-right direction with any component along `axis`
// removed, as a unit vector (or, looking straight along it, some other
// direction across it).
function rightAcross(camera, axis) {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).toArray();
  if (axis !== null) right[axis] = 0;
  const n = Math.hypot(...right);
  if (n < 1e-6) return axis === 0 ? [0, 1, 0] : [1, 0, 0];
  return right.map((v) => v / n);
}

export function objectHandles(obj, camera) {
  const c = obj.position;
  if (obj.kind === 'sphere') {
    const r = rightAcross(camera, null);
    return [{ id: 'radius', position: add(c, r, obj.radius), direction: r }];
  }
  if (obj.kind === 'rod' && obj.form !== 'line') {
    const r = rightAcross(camera, obj.axis);
    return [{ id: 'radius', position: add(c, r, obj.radius), direction: r }];
  }
  if (obj.kind === 'plane' && obj.form === 'slab') {
    const n = unitAxis(obj.axis);
    const along = rightAcross(camera, obj.axis);
    return [{ id: 'thickness', position: add(add(c, n, obj.thickness / 2), along, THICKNESS_HANDLE_OFFSET), direction: n }];
  }
  return [];
}

// Dragging a value along a line in space -- a handle, or a plane along its
// normal: the line through `origin` along the unit vector `direction`,
// starting at `startValue`. Each pointer ray
// is turned into a distance along the line -- that of the line's point
// closest to the ray -- and the value moves by however far that's moved
// since the drag began (so grabbing a handle off-center doesn't make it
// jump). Snapped to whole cm unless Alt is held, like everything else
// -- or with `snap`, some other way (a slab's face moves half as far as
// its thickness changes, so its thickness is snapped instead).
export class LineDrag {
  constructor(origin, direction, startValue, snap = snapValue) {
    this.origin = new THREE.Vector3(...origin);
    this.direction = new THREE.Vector3(...direction);
    this.startValue = startValue;
    this.snap = snap;
    this.anchor = null;
  }

  // The distance along the line of its point closest to the ray, or null
  // when the ray runs (almost) parallel to it -- looking straight along
  // the line, the pointer can't say where along it it is. For the line
  // P0 + t a and the ray o + s d, the closest points satisfy
  //   t (a.a) - s (a.d) = -a.w   and   t (a.d) - s (d.d) = -d.w,
  // with w = P0 - o.
  along(ray) {
    const a = this.direction;
    const d = ray.direction;
    const w = new THREE.Vector3().subVectors(this.origin, ray.origin);
    const ad = a.dot(d);
    const denom = a.dot(a) * d.dot(d) - ad * ad;
    if (denom < 1e-6) return null;
    return (ad * d.dot(w) - d.dot(d) * a.dot(w)) / denom;
  }

  // The dragged value for a pointer ray (the start value until the first
  // ray anchors the drag).
  update(ray, altKey) {
    const t = this.along(ray);
    if (t === null) return this.value ?? this.startValue;
    if (this.anchor === null) this.anchor = t;
    const raw = this.startValue + (t - this.anchor);
    this.value = altKey ? raw : this.snap(raw);
    return this.value;
  }
}
