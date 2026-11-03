import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { objectHandles } from './handles.js';
import { SELECTION_COLOR, CAMERA_FOV } from './sceneConstants.js';

// The handles on the selected sphere, rod or slab (see handles.js for
// what each does), in the selection blue. They're drawn on top of
// everything (no depth test), so a handle inside a sphere or behind a
// field line is never hidden, and at the same size on screen however far
// away they are: every frame, each is scaled in proportion to its distance
// from the camera. Their positions are also updated every frame, since
// they depend on which way the camera faces. The hovered or dragged
// handle is drawn a little bigger.
//
// Sizes below are in "handle units", HANDLE_SCALE x the distance to the
// camera in world units -- about 10 pixels at the default zoom -- with
// the default field of view. A narrower one (the 2D cut's view) shows
// less at the same distance, so handles shrink in proportion (sizeAt).
const HANDLE_SCALE = 0.011;
const DEFAULT_FOV_TAN = Math.tan((CAMERA_FOV * Math.PI) / 360);
const sizeAt = (camera, position) => (camera.position.distanceTo(position) * HANDLE_SCALE * Math.tan((camera.fov * Math.PI) / 360)) / DEFAULT_FOV_TAN;
const GROWN = 1.25;

function HandleMaterial({ color }) {
  return <meshBasicMaterial color={color} depthTest={false} transparent />;
}

// A ball: a radius or thickness handle.
function Dot({ color = SELECTION_COLOR }) {
  return (
    <mesh renderOrder={10}>
      <sphereGeometry args={[1, 20, 16]} />
      <HandleMaterial color={color} />
    </mesh>
  );
}


// charge: the selected object. hoveredId / activeId: the
// id of the handle under the pointer, and of the one being dragged.
// isHidden(handle): whether to leave a handle out (in the 2D cut's view,
// one that would move something out of the cut).
export default function ObjectHandles({ charge, hoveredId, activeId, isHidden = () => false }) {
  const camera = useThree((state) => state.camera);
  const groups = useRef({});

  useFrame(({ camera: cam }) => {
    for (const h of objectHandles(charge, cam)) {
      const g = groups.current[h.id];
      if (!g) continue;
      g.position.set(...h.position);
      const grown = h.id === hoveredId || h.id === activeId ? GROWN : 1;
      g.scale.setScalar(sizeAt(cam, g.position) * grown);
    }
  });

  return objectHandles(charge, camera).filter((h) => !isHidden(h)).map((h) => {
    return (
      // Placed and sized here too, for the first frame (useFrame keeps
      // them up to date after that).
      <group
        key={h.id}
        ref={(g) => { groups.current[h.id] = g; }}
        position={h.position}
        scale={sizeAt(camera, new THREE.Vector3(...h.position))}
      >
        <Dot />
      </group>
    );
  });
}
