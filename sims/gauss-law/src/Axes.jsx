import { useEffect, useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { WORLD_HALF_EXTENT } from './sceneConstants.js';

const AXIS_DIRECTIONS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];
// Same colors as the corner axis gizmo, so the two read as one system.
const AXIS_COLORS = ['#ff2060', '#20b870', '#2080ff'];
const AXIS_NAMES = ['x', 'y', 'z'];
const ORIGIN_RADIUS = 0.08;
const LABEL_OFFSET = 0.45;
const LABEL_SIZE = 0.6; // world units

// An axis name drawn as a sprite: the letter is painted onto a small 2D
// canvas, which becomes the texture of a quad that always faces the
// camera. Living inside the WebGL scene (rather than as a DOM overlay)
// means it can never cover the sidebar or block pointer hit-testing.
function AxisLabel({ text, color, position }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = 'italic bold 96px "Times New Roman", Times, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; // white halo for legibility over whatever is behind it
    ctx.strokeText(text, 64, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 64);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[LABEL_SIZE, LABEL_SIZE, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

// x, y and z axes through the origin, spanning the world cube, each with a
// label at its positive end, plus a small dark dot marking the origin
// itself.
export default function Axes() {
  return (
    <group>
      {AXIS_DIRECTIONS.map((u, axis) => {
        const color = AXIS_COLORS[axis];
        const end = u.clone().multiplyScalar(WORLD_HALF_EXTENT).toArray();
        const start = u.clone().multiplyScalar(-WORLD_HALF_EXTENT).toArray();
        return (
          <group key={axis}>
            <Line points={[start, end]} color={color} lineWidth={2} transparent opacity={0.8} />
            <AxisLabel text={AXIS_NAMES[axis]} color={color} position={u.clone().multiplyScalar(WORLD_HALF_EXTENT + LABEL_OFFSET).toArray()} />
          </group>
        );
      })}
      <mesh>
        <sphereGeometry args={[ORIGIN_RADIUS, 16, 16]} />
        <meshBasicMaterial color="#333" />
      </mesh>
    </group>
  );
}
