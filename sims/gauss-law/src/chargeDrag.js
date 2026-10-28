// Where a charge being positioned with the pointer should be -- shared by
// placing a new charge (Viewer's placement ghost) and moving a placed one,
// so the two always follow the same rules. Plain JS, no React.
//
// It's a small state machine with two phases:
//
//   'floor' (new placements only): the charge sits where the pointer's ray
//     meets the floor (z = 0), snapped to the grid. Holding Shift does
//     nothing here -- see liftOff().
//   'free': the drag rules for an already-placed charge. Without Shift it
//     slides horizontally at its current height; with Shift it moves
//     vertically along a camera-facing plane through it. Either way it
//     moves by however far the pointer's hit point on that plane has moved
//     since the current mode began (rather than jumping so its center sits
//     under the pointer), and pressing or releasing Shift re-anchors at
//     the charge's current position, so switching never makes it jump.
import * as THREE from 'three';
import { intersectHorizontalPlane, intersectVerticalPlane, snapValue, isWithinFloor, clampToWorld } from './geometry.js';

export class ChargeDrag {
  // startPos: a placed charge's position, or null for a new placement.
  constructor(startPos = null) {
    this.phase = startPos ? 'free' : 'floor';
    this.position = startPos;
    this.mode = null; // 'horizontal' | 'vertical', in the free phase
    this.modeStartPos = startPos;
    this.anchorHit = null;
  }

  // A new placement's Shift *press*: fix x and y where the charge is now
  // and switch to the free phase, so moving the pointer raises or lowers
  // it. Does nothing unless there's a floor point to fix -- which is also
  // why Shift already being held when placement starts does nothing: the
  // press happened before there was anything to fix. Returns whether it
  // lifted off.
  liftOff() {
    if (this.phase !== 'floor' || !this.position) return false;
    this.phase = 'free';
    this.mode = null;
    return true;
  }

  // The pointer has left the canvas (or is over an overlay). A placement
  // still on the floor has no floor point any more, so a Shift press now
  // can't lift it. In the free phase the position is kept, so the drag
  // picks up where it was once the pointer comes back.
  pointerLeft() {
    if (this.phase === 'floor') this.position = null;
  }

  // Recomputes the position for a new pointer ray. `altKey` turns off grid
  // snapping. Returns the position, or null (floor phase only) when the
  // ray doesn't land on the floor grid.
  update({ ray, camera, shiftKey, altKey }) {
    const snap = altKey ? (v) => v : snapValue;

    if (this.phase === 'floor') {
      const hit = intersectHorizontalPlane(ray, 0);
      const x = hit && snap(hit.x);
      const y = hit && snap(hit.y);
      this.position = hit && isWithinFloor(x, y) ? [x, y, 0] : null;
      return this.position;
    }

    const mode = shiftKey ? 'vertical' : 'horizontal';
    if (mode !== this.mode) {
      this.mode = mode;
      this.modeStartPos = this.position;
      this.anchorHit = null;
    }
    const start = this.modeStartPos;
    const hit = mode === 'vertical'
      ? intersectVerticalPlane(ray, camera, new THREE.Vector3(...start))
      : intersectHorizontalPlane(ray, start[2]);
    if (!hit) return this.position; // e.g. the ray runs parallel to the plane
    if (!this.anchorHit) {
      this.anchorHit = hit;
      return this.position;
    }
    let [x, y, z] = start;
    if (mode === 'horizontal') {
      x = clampToWorld(snap(x + hit.x - this.anchorHit.x));
      y = clampToWorld(snap(y + hit.y - this.anchorHit.y));
    } else {
      z = clampToWorld(snap(z + hit.z - this.anchorHit.z));
    }
    const [cx, cy, cz] = this.position;
    if (x !== cx || y !== cy || z !== cz) this.position = [x, y, z];
    return this.position;
  }
}
