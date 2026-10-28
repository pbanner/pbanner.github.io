import { useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { WORLD_HALF_EXTENT, INITIAL_CAMERA_POSITION, INITIAL_CAMERA_TARGET, CAMERA_FOV } from './sceneConstants.js';

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

export default function Viewer() {
  const controlsRef = useRef();

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

  return (
    <div className="viewer">
      <Canvas
        camera={{ position: INITIAL_CAMERA_POSITION, up: [0, 0, 1], fov: CAMERA_FOV }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#f4f5f7']} />
        <ambientLight intensity={1.2} />
        <CameraLight />

        <Floor />

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
