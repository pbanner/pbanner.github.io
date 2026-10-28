import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHARGE_RADIUS } from './sceneConstants.js';
import { SNAP_STEP } from './geometry.js';

// Gap between the top of the charge (as drawn on screen) and the bottom
// of the readout panel.
const PANEL_GAP_PX = 10;
// The dragged charge is drawn enlarged (ChargeMarker's highlight), so
// measure its top from that size.
const HIGHLIGHT_SCALE = 1.15;

// The readout counts in ticks: one readout unit is one SNAP_STEP of world
// distance, i.e. the spacing of the grid lines and the axis tick dots. So
// a snapped charge always reads as whole numbers, and the world's edges
// (at +/-5 world units) read as +/-10. Only the readout uses this scale;
// positions in state stay in world units.
const READOUT_UNITS_PER_WORLD_UNIT = 1 / SNAP_STEP;

// Snapped coordinates are whole numbers on the readout's scale, so they're
// shown without decimals; a coordinate placed freely (Alt) gets one. A
// true minus sign reads better than a hyphen.
function formatCoordinate(worldValue) {
  const v = worldValue * READOUT_UNITS_PER_WORLD_UNIT;
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
export function CoordinateReadoutPanel({ panelRef, position }) {
  const [x, y, z] = position.map(formatCoordinate);
  return (
    <div ref={panelRef} className="coordinate-readout">
      ({x}, {y}, {z})
    </div>
  );
}

const projected = new THREE.Vector3();

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
    // The top of the sphere: the camera's up is +z and it never rolls, so
    // the world point straight above the center is the top on screen too.
    const [, topY] = toPixels([position[0], position[1], position[2] + CHARGE_RADIUS * HIGHLIGHT_SCALE]);
    const bottom = Math.min(topY, py) - PANEL_GAP_PX;
    panel.style.transform = `translate(${px}px, ${bottom}px) translate(-50%, -100%)`;
    panel.style.visibility = 'visible';
  });
  return null;
}
