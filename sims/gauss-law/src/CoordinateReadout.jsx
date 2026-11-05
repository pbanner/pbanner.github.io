import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHARGE_RADIUS } from './sceneConstants.js';
import { CM } from './geometry.js';

// Gap between the top of the charge (as drawn on screen) and the bottom
// of the readout panel.
const PANEL_GAP_PX = 10;
// The dragged charge is drawn enlarged (ChargeMarker's highlight), so
// measure its top from that size.
const HIGHLIGHT_SCALE = 1.15;

// The readout is in cm: one cm is the spacing of the grid lines and the
// axis tick dots (geometry.js's CM). So a snapped charge always reads as
// whole numbers, and the world's edges (at +/-5 world units) read as
// +/-10. Positions in state stay in world units.
//
// Snapped coordinates are whole numbers of cm, so they're shown without
// decimals; a coordinate placed freely (Alt) gets two. A true minus sign
// reads better than a hyphen.
function formatCoordinate(worldValue) {
  const v = worldValue / CM;
  const rounded = Math.round(v);
  const text = Math.abs(v - rounded) < 1e-6 ? String(rounded) : v.toFixed(2);
  return text.replace(/^-/, '−').replace(/^−0(\.0)?$/, '0');
}

// The (x, y, z) readout floating above a charge being placed or dragged.
// Two halves, because the panel is ordinary DOM (so its text is crisp and
// it's styled like the app's other floating panels) but where it goes
// depends on the 3D camera:
//
//   - CoordinateReadoutPanel is the panel itself, rendered by Viewer next
//     to the <Canvas>. React writes its text.
//   - CoordinateReadoutTracker lives inside the <Canvas>. Every frame it
//     projects the charge's position to screen pixels and moves the panel
//     there by writing its style.transform directly, so the panel follows
//     orbiting and zooming smoothly without React re-rendering each frame.
//
// The panel starts hidden (see .coordinate-readout in App.css) and the
// tracker reveals it once it has been positioned, so it never flashes at
// the corner of the screen for a frame.
//
// The panel shows `position` as (x, y, z) cm -- or only the coordinates
// in `axes`, for something that can only move in those (a plane along its
// normal: "x = −4 cm"; a rod across itself: "(y, z) = (2, 0) cm") -- or,
// given a `label`, that label and a single length `value` instead (e.g.
// "Radius = 3 cm", while a handle drags a sphere's radius), or the label
// alone ("Radius", while the pointer is over the handle).
const AXIS_NAMES = ['x', 'y', 'z'];
function readoutText(position, axes, label, value) {
  if (label) return value === undefined ? label : `${label} = ${formatCoordinate(value)} cm`;
  const names = axes.map((k) => AXIS_NAMES[k]);
  const values = axes.map((k) => formatCoordinate(position[k]));
  if (axes.length === 1) return `${names[0]} = ${values[0]} cm`;
  if (axes.length === 2) return `(${names.join(', ')}) = (${values.join(', ')}) cm`;
  return `(${values.join(', ')}) cm`;
}
export function CoordinateReadoutPanel({ panelRef, position, axes = [0, 1, 2], label, value }) {
  return (
    <div ref={panelRef} className="coordinate-readout">
      {readoutText(position, axes, label, value)}
    </div>
  );
}

const projected = new THREE.Vector3();
const up = new THREE.Vector3();

export function CoordinateReadoutTracker({ panelRef, position }) {
  useFrame(({ camera, size }) => {
    const panel = panelRef.current;
    if (!panel || !position) return;
    // project() maps a world point to normalized device coordinates:
    // -1..1 across the canvas in each direction, with +y up.
    const toPixels = (point) => {
      projected.set(...point).project(camera);
      return [(projected.x + 1) / 2 * size.width, (1 - projected.y) / 2 * size.height];
    };
    const [px, py] = toPixels(position);
    // The top of the sphere on screen: the point one (enlarged) radius from
    // its center along the camera's screen-up direction, which needn't be
    // world +z once the axis gizmo has turned the view.
    const screenUp = up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const [, topY] = toPixels(position.map((c, k) => c + screenUp.getComponent(k) * CHARGE_RADIUS * HIGHLIGHT_SCALE));
    const bottom = Math.min(topY, py) - PANEL_GAP_PX;
    panel.style.transform = `translate(${px}px, ${bottom}px) translate(-50%, -100%)`;
    panel.style.visibility = 'visible';
  });
  return null;
}
