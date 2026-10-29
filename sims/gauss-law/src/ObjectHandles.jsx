import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { objectHandles } from './handles.js';
import { SELECTION_COLOR } from './sceneConstants.js';

// The handles on the selected sphere, rod or plane (see handles.js for
// what each does), in the selection blue. They're drawn on top of
// everything (no depth test), so a handle inside a sphere or behind a
// field line is never hidden, and at the same size on screen however far
// away they are: every frame, each is scaled in proportion to its distance
// from the camera. Their positions are also updated every frame, since
// some depend on which way the camera faces. The hovered or dragged
// handle is drawn a little bigger.
//
// Sizes below are in "handle units", HANDLE_SCALE x the distance to the
// camera in world units -- about 10 pixels at the default zoom.
const HANDLE_SCALE = 0.011;
const GROWN = 1.25;
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function HandleMaterial() {
  return <meshBasicMaterial color={SELECTION_COLOR} depthTest={false} transparent />;
}

// A ball: a radius or thickness handle.
function Dot() {
  return (
    <mesh renderOrder={10}>
      <sphereGeometry args={[1, 20, 16]} />
      <HandleMaterial />
    </mesh>
  );
}

// A double-headed arrow along its local y.
function Arrow() {
  return (
    <>
      <mesh renderOrder={10}>
        <cylinderGeometry args={[0.3, 0.3, 2.2, 12]} />
        <HandleMaterial />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} renderOrder={10} position={[0, 1.6 * s, 0]} rotation={[s > 0 ? 0 : Math.PI, 0, 0]}>
          <coneGeometry args={[0.8, 1.1, 16]} />
          <HandleMaterial />
        </mesh>
      ))}
    </>
  );
}

// A ball with four arrowheads around it in its local xy plane: moves
// within that plane.
function Move() {
  return (
    <>
      <mesh renderOrder={10}>
        <sphereGeometry args={[0.7, 20, 16]} />
        <HandleMaterial />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const angle = (i * Math.PI) / 2;
        return (
          <mesh key={i} renderOrder={10} position={[1.6 * Math.cos(angle), 1.6 * Math.sin(angle), 0]} rotation={[0, 0, angle - Math.PI / 2]}>
            <coneGeometry args={[0.55, 0.9, 12]} />
            <HandleMaterial />
          </mesh>
        );
      })}
    </>
  );
}

const SHAPES = { dot: Dot, arrow: Arrow, move: Move };

// charge: the selected object. hoveredId / activeId: the id of the handle
// under the pointer, and of the one being dragged.
export default function ObjectHandles({ charge, hoveredId, activeId }) {
  const camera = useThree((state) => state.camera);
  const groups = useRef({});
  const direction = new THREE.Vector3();

  useFrame(({ camera: cam }) => {
    for (const h of objectHandles(charge, cam)) {
      const g = groups.current[h.id];
      if (!g) continue;
      g.position.set(...h.position);
      // An arrow points along its line; the move handle lies in its plane.
      g.quaternion.setFromUnitVectors(h.shape === 'move' ? Z : Y, direction.set(...h.direction));
      const grown = h.id === hoveredId || h.id === activeId ? GROWN : 1;
      g.scale.setScalar(cam.position.distanceTo(g.position) * HANDLE_SCALE * grown);
    }
  });

  return objectHandles(charge, camera).map((h) => {
    const Shape = SHAPES[h.shape];
    return (
      // Placed and sized here too, for the first frame (useFrame keeps
      // them up to date after that).
      <group
        key={h.id}
        ref={(g) => { groups.current[h.id] = g; }}
        position={h.position}
        scale={camera.position.distanceTo(new THREE.Vector3(...h.position)) * HANDLE_SCALE}
      >
        <Shape />
      </group>
    );
  });
}
