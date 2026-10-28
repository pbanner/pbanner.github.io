import { useImperativeHandle, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import ChargeMarker from './ChargeMarker.jsx';
import { getChargeType } from './chargeTypes.js';
import { rayFromClient, intersectHorizontalPlane, snapValue, isWithinFloor } from './geometry.js';
import { WORLD_HALF_EXTENT, INITIAL_CAMERA_POSITION, INITIAL_CAMERA_TARGET, CAMERA_FOV, CLICK_MOVE_THRESHOLD } from './sceneConstants.js';

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
export default function Viewer({ ref, charges, ghost, armedTypeId, onPlaceClick }) {
  const wrapperRef = useRef();
  const controlsRef = useRef();
  const placeClickStartRef = useRef(null);

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

  // Click-to-place's second click. Recorded on pointerdown and acted on at
  // pointerup only if the pointer barely moved -- so while a charge is
  // armed, a real drag on the canvas still orbits the camera as usual
  // (OrbitControls sees the same events), and only a genuine click drops
  // the charge.
  const handlePointerDownCapture = (e) => {
    placeClickStartRef.current = armedTypeId && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  };
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
      onPointerDownCapture={handlePointerDownCapture}
      onPointerUp={handlePointerUp}
    >
      <Canvas
        camera={{ position: INITIAL_CAMERA_POSITION, up: [0, 0, 1], fov: CAMERA_FOV }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#f4f5f7']} />
        <ambientLight intensity={1.2} />
        <CameraLight />

        <Floor />

        {charges.map((charge) => (
          <ChargeMarker key={charge.id} type={getChargeType(charge.type)} position={charge.position} />
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
