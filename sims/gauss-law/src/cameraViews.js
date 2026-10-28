// Camera moves for the axis gizmo (AxisGizmo.jsx): clicking an axis label
// turns the camera to look along that axis, by the smallest rotation that
// gets it there. The view is free to roll or flip on the way. No React.
//
// A camera's orientation is a rotation (here a quaternion) taking its own
// axes to the world: its +x is screen-right, +y is screen-up, and +z points
// back out of the screen, so it looks along its -z. three.js cameras work
// this way.
import { Matrix4, Quaternion, Vector3 } from 'three';

const WORLD_AXES = [
  new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0), new Vector3(0, -1, 0),
  new Vector3(0, 0, 1), new Vector3(0, 0, -1),
];

// The orientation to end on when the gizmo's `axis` head is clicked
// (e.g. [-1, 0, 0] for -x): the camera sits on that side of its target,
// looking back along -axis. Returned as { quaternion, up }, up being the
// world direction that ends up at the top of the screen.
//
// Only the looking direction is fixed by the click; the end's roll (which
// way is up on screen) is chosen in two steps:
//   1. Swing: the smallest rotation turning the current looking direction
//      onto the new one is the rotation about the axis perpendicular to
//      both (setFromUnitVectors). Applying it to the current screen-up
//      gives where screen-up would land with no twist at all.
//   2. Snap: of the four world axes perpendicular to the new looking
//      direction, take the one closest to that. So every axis view comes
//      out with the scene's axes along the screen's edges, after at most
//      45 degrees of extra twist.
export function axisViewOrientation(current, axis) {
  const back = new Vector3(...axis).normalize(); // camera +z: from target toward camera
  const forward = back.clone().negate();
  const currentForward = new Vector3(0, 0, -1).applyQuaternion(current);
  const currentUp = new Vector3(0, 1, 0).applyQuaternion(current);

  const swing = new Quaternion().setFromUnitVectors(currentForward, forward);
  const swungUp = currentUp.applyQuaternion(swing);

  let up = null;
  for (const candidate of WORLD_AXES) {
    if (Math.abs(candidate.dot(forward)) > 0.5) continue; // along the view, not across it
    if (!up || candidate.dot(swungUp) > up.dot(swungUp)) up = candidate;
  }
  up = up.clone();

  const right = new Vector3().crossVectors(up, back);
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back));
  return { quaternion, up };
}
