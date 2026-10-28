import { useImperativeHandle, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { ChargeDrag } from './chargeDrag.js';
import ChargeMarker from './ChargeMarker.jsx';
import Axes from './Axes.jsx';
import { getChargeType } from './chargeTypes.js';
import { rayFromClient, pickCharge, SNAP_STEP } from './geometry.js';
import { WORLD_HALF_EXTENT, CHARGE_RADIUS, INITIAL_CAMERA_POSITION, INITIAL_CAMERA_TARGET, CAMERA_FOV, CLICK_MOVE_THRESHOLD } from './sceneConstants.js';

// A directional light that rides along with the camera, so whatever side of
// the scene is facing the viewer is always the lit side -- same approach as
// the Bloch sphere sim's own CameraLight.
function CameraLight() {
  const lightRef = useRef();
  const { camera } = useThree();
  useFrame(() => {
    lightRef.current?.position.copy(camera.position);
  });
  return <directionalLight ref={lightRef} intensity={2.2} />;
}

// The z = 0 reference plane, drawn as a single light-gray grid with a line
// every SNAP_STEP, so every grid crossing is a point a charge can snap to.
// gridHelper takes (size, divisions, center-line color, line color); both
// colors are the same so the lines through the origin don't stand out
// either. It's built lying in three's default XZ plane, so it's rotated a
// quarter turn about x to lie in XY instead (our floor, since z is up).
const GRID_COLOR = '#d3d7dc';
function Floor() {
  const size = 2 * WORLD_HALF_EXTENT;
  return (
    <gridHelper args={[size, Math.round(size / SNAP_STEP), GRID_COLOR, GRID_COLOR]} rotation={[Math.PI / 2, 0, 0]} />
  );
}

// charges: [{ id, type, position: [x, y, z] }]
// ghost: { type, position } for the translucent placement preview, or null
// armedTypeId: the charge type waiting for click-to-place's second click
// onPlaceClick(clientX, clientY, modifiers): that second click, on the canvas
// removeMode: the sidebar's delete tool is on, so clicking a charge deletes it
// onMoveCharge(id, position) / onDeleteCharge(id): edits to placed charges
export default function Viewer({ ref, charges, ghost, armedTypeId, onPlaceClick, removeMode, onMoveCharge, onDeleteCharge }) {
  const wrapperRef = useRef();
  const controlsRef = useRef();
  const placeClickStartRef = useRef(null);
  // The ChargeDrag tracking the placement ghost while a charge is armed.
  const placementRef = useRef(null);

  // The charge under the pointer (highlighted, and sets the cursor), and the
  // one being dragged, if any.
  const [hoveredId, setHoveredId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const dragRef = useRef(null);

  // Can't use controls.reset(): drei captures the controls' saved state
  // before applying the `target` prop, so reset() would aim at the wrong
  // point (same issue the Bloch sphere sim works around). Set both
  // explicitly instead.
  const resetView = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(...INITIAL_CAMERA_POSITION);
    controls.target.set(...INITIAL_CAMERA_TARGET);
    controls.update();
  };

  // The ray from the camera through a viewport point, or null if that
  // point isn't actually on the 3D canvas -- off the viewer entirely, or
  // over one of the overlay controls drawn on top of it. Checked with
  // elementFromPoint (what's really under the pointer) rather than the
  // canvas's bounding rect, since the rect alone can't see overlays.
  const rayAt = (clientX, clientY) => {
    const wrapper = wrapperRef.current;
    const controls = controlsRef.current;
    if (!wrapper || !controls) return null;
    const under = document.elementFromPoint(clientX, clientY);
    if (!(under instanceof HTMLCanvasElement) || !wrapper.contains(under)) return null;
    return rayFromClient(controls.object, under.getBoundingClientRect(), clientX, clientY);
  };

  // Placement goes through a ChargeDrag (see chargeDrag.js) so that, as
  // with moving a placed charge, Shift can raise or lower the ghost. App.jsx
  // drives it through the ref: startPlacement() when a charge is armed,
  // placementAt() on every pointer move (and on release, to place it), and
  // liftPlacement() when Shift is pressed.
  const startPlacement = () => {
    placementRef.current = new ChargeDrag();
  };

  // Where a new charge dropped at this viewport point would land, or null
  // if it can't go there (off the canvas, or off the floor grid before
  // it's been lifted). This is the one function that answers "where in 3D
  // does a 2D drop go?" -- App.jsx uses it both to position the 3D ghost
  // and to actually place the charge. `modifiers` is the event's
  // { shiftKey, altKey }.
  const placementAt = (clientX, clientY, modifiers) => {
    const ray = rayAt(clientX, clientY);
    const placement = placementRef.current;
    if (!placement) return null;
    if (!ray) {
      placement.pointerLeft();
      return null;
    }
    return placement.update({ ray, camera: controlsRef.current.object, shiftKey: modifiers.shiftKey, altKey: modifiers.altKey });
  };

  const liftPlacement = () => placementRef.current?.liftOff() ?? false;

  useImperativeHandle(ref, () => ({ startPlacement, placementAt, liftPlacement }));

  // Moves a placed charge, following the same ChargeDrag rules as a
  // placement once it's been lifted: drag to slide it horizontally,
  // Shift+drag to raise or lower it.
  const startDrag = (charge, downEvent) => {
    const drag = new ChargeDrag(charge.position);
    dragRef.current = { id: charge.id, drag };
    setDraggingId(charge.id);

    const update = (ev) => {
      const controls = controlsRef.current;
      if (!dragRef.current || !controls) return;
      // Deliberately not rayAt(): the drag should keep working even while
      // the pointer passes over an overlay (e.g. on its way to the trash).
      const ray = rayFromClient(controls.object, wrapperRef.current.getBoundingClientRect(), ev.clientX, ev.clientY);
      const before = drag.position;
      const after = drag.update({ ray, camera: controls.object, shiftKey: ev.shiftKey, altKey: ev.altKey });
      if (after !== before) onMoveCharge(charge.id, after);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDraggingId(null);
      // Dropping a charge on the sidebar's trash can deletes it.
      if (d && document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-role="trash-target"]')) {
        onDeleteCharge(d.id);
      }
    };
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    // Anchor at the press itself, so the very first pixels of movement count.
    update(downEvent);
  };

  // Runs in the *capture* phase -- on the way down from the outer page
  // to the canvas, before the event reaches OrbitControls, which listens
  // on an element inside this wrapper. That ordering is what lets one
  // left-drag mean two different things: on a charge, stopPropagation()
  // here keeps OrbitControls from ever seeing the press, so the charge
  // moves and the camera doesn't; on empty space it passes through
  // untouched and the camera orbits.
  //
  // While a charge is armed, this just records the press for
  // click-to-place's second click, which is acted on at pointerup only if
  // the pointer barely moved -- so a real drag still orbits the camera,
  // and only a genuine click drops the charge.
  const handlePointerDownCapture = (e) => {
    placeClickStartRef.current = null;
    if (e.button !== 0) return; // right-drag pans; leave it to OrbitControls
    if (armedTypeId) {
      placeClickStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const ray = rayAt(e.clientX, e.clientY);
    const charge = ray && pickCharge(ray, charges, CHARGE_RADIUS);
    if (!charge) return;
    e.stopPropagation();
    if (removeMode) {
      onDeleteCharge(charge.id);
      setHoveredId(null);
    } else {
      startDrag(charge, e);
    }
  };

  const handlePointerMove = (e) => {
    if (dragRef.current || armedTypeId) return;
    const ray = rayAt(e.clientX, e.clientY);
    const id = (ray && pickCharge(ray, charges, CHARGE_RADIUS)?.id) ?? null;
    if (id !== hoveredId) setHoveredId(id);
  };

  let cursor;
  if (draggingId != null) cursor = 'grabbing';
  else if (hoveredId != null && !armedTypeId) cursor = removeMode ? 'pointer' : 'grab';

  const handlePointerUp = (e) => {
    const start = placeClickStartRef.current;
    placeClickStartRef.current = null;
    if (!start || !armedTypeId) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_MOVE_THRESHOLD) return;
    onPlaceClick(e.clientX, e.clientY, { shiftKey: e.shiftKey, altKey: e.altKey });
  };

  return (
    <div
      ref={wrapperRef}
      className="viewer"
      style={{ cursor }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoveredId(null)}
    >
      <Canvas
        camera={{ position: INITIAL_CAMERA_POSITION, up: [0, 0, 1], fov: CAMERA_FOV }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#f4f5f7']} />
        <ambientLight intensity={1.2} />
        <CameraLight />

        <Floor />
        <Axes />

        {charges.map((charge) => (
          <ChargeMarker
            key={charge.id}
            type={getChargeType(charge.type)}
            position={charge.position}
            highlighted={charge.id === draggingId || (draggingId == null && charge.id === hoveredId)}
          />
        ))}

        {ghost && <ChargeMarker type={getChargeType(ghost.type)} position={ghost.position} ghost />}

        {/* makeDefault registers these as the scene's controls, which the
            axis gizmo needs in order to swing the camera when an axis is
            clicked. Left-drag rotates, scroll/pinch zooms, and right-drag
            (or two-finger drag) pans. */}
        <OrbitControls ref={controlsRef} target={INITIAL_CAMERA_TARGET} makeDefault />

        {/* Orientation widget in the lower-left corner. Clicking one of its
            axis labels swings the camera to look down that axis. */}
        <GizmoHelper alignment="bottom-left" margin={[70, 70]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.9} />
        </GizmoHelper>
      </Canvas>

      <button className="control-button reset-view-button" onClick={resetView}>
        Reset View
      </button>
    </div>
  );
}
