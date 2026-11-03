import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { objectHandles } from './handles.js';
import { SELECTION_COLOR, CAMERA_FOV } from './sceneConstants.js';

// The size handles on the selected sphere, rod or slab (see handles.js):
// each a shaded white ball in a blue ring, with a blue double arrow inside
// that lies along what dragging it changes -- out from the middle and back
// for a radius, along the normal for a thickness -- as it looks on screen.
//
// They're drawn on top of everything (no depth test), so a handle behind
// a field line is never hidden, and at the same size on screen however far
// away they are: every frame, each is scaled in proportion to its distance
// from the camera. Their positions, and their arrows' angles, are also
// updated every frame, since they depend on which way the camera faces.
// The hovered or dragged handle is drawn a little bigger. (Viewer.jsx
// labels it, "Radius" or "Thickness".)
//
// Sizes below are in "handle units", HANDLE_SCALE x the distance to the
// camera in world units -- about 10 pixels at the default zoom -- with
// the default field of view. A narrower one (the 2D cut's view) shows
// less at the same distance, so handles shrink in proportion (sizeAt).
const HANDLE_SCALE = 0.011;
const DEFAULT_FOV_TAN = Math.tan((CAMERA_FOV * Math.PI) / 360);
const sizeAt = (camera, position) => (camera.position.distanceTo(position) * HANDLE_SCALE * Math.tan((camera.fov * Math.PI) / 360)) / DEFAULT_FOV_TAN;
const GROWN = 1.25;
const BALL_RADIUS = 0.75;
const RING = [0.75, 1.02]; // inner and outer radius

// A double-headed arrow along x, centered on the origin, flat in the xy
// plane: a bar with a triangular head at each end.
function doubleArrowShape() {
  const [half, head, headHalf, bar] = [0.58, 0.26, 0.24, 0.07];
  const s = new THREE.Shape();
  s.moveTo(-half, 0);
  s.lineTo(-half + head, headHalf);
  s.lineTo(-half + head, bar);
  s.lineTo(half - head, bar);
  s.lineTo(half - head, headHalf);
  s.lineTo(half, 0);
  s.lineTo(half - head, -headHalf);
  s.lineTo(half - head, -bar);
  s.lineTo(-half + head, -bar);
  s.lineTo(-half + head, -headHalf);
  s.closePath();
  return s;
}
const ARROW_SHAPE = doubleArrowShape();

const projected = [new THREE.Vector3(), new THREE.Vector3()];

// charge: the selected object. hoveredId / activeId: the id of the handle
// under the pointer, and of the one being dragged. isHidden(handle):
// whether to leave a handle out (in the 2D cut's view, one that would
// move something out of the cut).
export default function ObjectHandles({ charge, hoveredId, activeId, isHidden = () => false }) {
  const camera = useThree((state) => state.camera);
  const groups = useRef({});
  const arrows = useRef({});

  useFrame(({ camera: cam, size }) => {
    for (const h of objectHandles(charge, cam)) {
      const g = groups.current[h.id];
      if (!g) continue;
      g.position.set(...h.position);
      const grown = h.id === hoveredId || h.id === activeId ? GROWN : 1;
      g.scale.setScalar(sizeAt(cam, g.position) * grown);
      // The arrow, which faces the camera, turned to lie along the
      // handle's direction as it looks on screen: the angle, in pixels,
      // from the handle to a point a step along its direction.
      const arrow = arrows.current[h.id];
      if (arrow) {
        const [a, b] = projected;
        a.set(...h.position).project(cam);
        b.set(...h.position.map((v, k) => v + h.direction[k])).project(cam);
        arrow.rotation.z = Math.atan2((b.y - a.y) * size.height, (b.x - a.x) * size.width);
      }
    }
  });

  return objectHandles(charge, camera).filter((h) => !isHidden(h)).map((h) => (
    // Placed and sized here too, for the first frame (useFrame keeps them
    // up to date after that).
    <group
      key={h.id}
      ref={(g) => { groups.current[h.id] = g; }}
      position={h.position}
      scale={sizeAt(camera, new THREE.Vector3(...h.position))}
    >
      <mesh renderOrder={10}>
        <sphereGeometry args={[BALL_RADIUS, 24, 18]} />
        <meshStandardMaterial color="#ffffff" roughness={0.45} depthTest={false} transparent />
      </mesh>
      <Billboard>
        <mesh renderOrder={11}>
          <ringGeometry args={[RING[0], RING[1], 40]} />
          <meshBasicMaterial color={SELECTION_COLOR} depthTest={false} transparent />
        </mesh>
        <mesh ref={(m) => { arrows.current[h.id] = m; }} renderOrder={12}>
          <shapeGeometry args={[ARROW_SHAPE]} />
          <meshBasicMaterial color={SELECTION_COLOR} depthTest={false} transparent />
        </mesh>
      </Billboard>
    </group>
  ));
}
