import { useImperativeHandle, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import ChargeMarker from './ChargeMarker.jsx';
import Axes from './Axes.jsx';
import { getChargeType } from './chargeTypes.js';
import { rayFromClient, intersectHorizontalPlane, intersectVerticalPlane, snapValue, isWithinFloor, clampToWorld, pickCharge } from './geometry.js';
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

// The z = 0 reference plane: a faintly tinted translucent sheet plus two
// grid layers (fine lines every 0.5, darker ones every 1). gridHelper is
// built lying in three's default XZ plane, so it's rotated a quarter turn
// about x to lie in XY instead (our floor, since z is up).
function Floor() {
  const size = 2 * WORLD_HALF_EXTENT;
  return (
    <group>
      <mesh renderOrder={-1}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color="#b9c7d6" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <gridHelper args={[size, size * 2, '#c4c9cf', '#c4c9cf']} rotation={[Math.PI / 2, 0, 0]} />
      <gridHelper args={[size, size, '#7d8590', '#8f97a1']} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.001]} />
    </group>
  );
}

// charges: [{ id, type, position: [x, y, z] }]
// ghost: { type, position } for the translucent placement preview, or null
// armedTypeId: the charge type waiting for click-to-place's second click
// onPlaceClick(clientX, clientY): that second click, on the canvas
// removeMode: the sidebar's delete tool is on, so clicking a charge deletes it
// onMoveCharge(id, position) / onDeleteCharge(id): edits to placed charges
export default function Viewer({ ref, charges, ghost, armedTypeId, onPlaceClick, removeMode, onMoveCharge, onDeleteCharge }) {
  const wrapperRef = useRef();
  const controlsRef = useRef();
  const placeClickStartRef = useRef(null);

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

  // Where on the floor grid a new charge dropped at this viewport point
  // would land -- snapped to the grid unless `free` -- or null if the
  // point isn't over the grid. This is the one function that answers
  // "where in 3D does a 2D drop go?"; App.jsx calls it (through the ref)
  // both to position the 3D ghost and to actually place the charge.
  const floorPointAt = (clientX, clientY, free = false) => {
    const ray = rayAt(clientX, clientY);
    if (!ray) return null;
    const hit = intersectHorizontalPlane(ray, 0);
    if (!hit) return null;
    const x = free ? hit.x : snapValue(hit.x);
    const y = free ? hit.y : snapValue(hit.y);
    if (!isWithinFloor(x, y)) return null;
    return [x, y, 0];
  };

  useImperativeHandle(ref, () => ({ floorPointAt }));

  // Where a dragged charge's ray meets the surface it's being dragged
  // along (see the top of geometry.js): a horizontal plane at the charge's
  // height for a plain drag, or a camera-facing vertical plane through it
  // for a Shift+drag.
  const dragSurfaceHit = (mode, ray, through) => {
    if (mode === 'vertical') return intersectVerticalPlane(ray, controlsRef.current.object, new THREE.Vector3(...through));
    return intersectHorizontalPlane(ray, through[2]);
  };

  // Moves a placed charge. The charge moves by however far the pointer's
  // hit point on the drag surface has moved since the drag began (rather
  // than jumping so its center sits under the pointer), so it doesn't
  // lurch when grabbed off-center. Pressing or releasing Shift mid-drag
  // switches surfaces; the drag re-anchors at the charge's current
  // position so that switch doesn't make it jump either.
  const startDrag = (charge) => {
    dragRef.current = { id: charge.id, mode: null, startPos: charge.position, currentPos: charge.position, anchorHit: null };
    setDraggingId(charge.id);

    const onMove = (ev) => {
      const d = dragRef.current;
      const controls = controlsRef.current;
      if (!d || !controls) return;
      // Deliberately not rayAt(): the drag should keep working even while
      // the pointer passes over an overlay (e.g. on its way to the trash).
      const ray = rayFromClient(controls.object, wrapperRef.current.getBoundingClientRect(), ev.clientX, ev.clientY);
      const mode = ev.shiftKey ? 'vertical' : 'horizontal';
      if (mode !== d.mode) {
        d.mode = mode;
        d.startPos = d.currentPos;
        d.anchorHit = null;
      }
      const hit = dragSurfaceHit(mode, ray, d.startPos);
      if (!hit) return; // e.g. the ray runs parallel to the drag surface
      if (!d.anchorHit) {
        d.anchorHit = hit;
        return;
      }
      const snap = ev.altKey ? (v) => v : snapValue;
      let [x, y, z] = d.startPos;
      if (mode === 'horizontal') {
        x = clampToWorld(snap(x + hit.x - d.anchorHit.x));
        y = clampToWorld(snap(y + hit.y - d.anchorHit.y));
      } else {
        z = clampToWorld(snap(z + hit.z - d.anchorHit.z));
      }
      const [cx, cy, cz] = d.currentPos;
      if (x === cx && y === cy && z === cz) return;
      d.currentPos = [x, y, z];
      onMoveCharge(d.id, d.currentPos);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
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
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
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
      startDrag(charge);
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
    onPlaceClick(e.clientX, e.clientY);
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
