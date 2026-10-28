import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeFieldArrows, arrowSpacing } from './fieldArrows.js';
import { WORLD_HALF_EXTENT } from './sceneConstants.js';

// Arrow shades: strongest field darkest (the field lines' color), weakest
// a light gray that still stands out against the background.
const STRONG_COLOR = new THREE.Color('#2f343b');
const WEAK_COLOR = new THREE.Color('#c2c8d0');

// Arrow proportions, as fractions of the spacing between arrows: long
// enough to read, short enough that neighbors never touch.
const ARROW_LENGTH = 0.6;
const SHAFT_RADIUS = 0.018;
const HEAD_RADIUS = 0.06;
const HEAD_LENGTH = 0.2;

// One arrow of total length 1, pointing along +y and centered on the
// origin (so each arrow is centered on the point it samples): a thin
// cylinder for the shaft and a cone for the head, merged into a single
// geometry so it can be drawn as one instanced mesh.
function makeArrowGeometry() {
  const shaftLength = 1 - HEAD_LENGTH / ARROW_LENGTH;
  const headLength = HEAD_LENGTH / ARROW_LENGTH;
  const shaft = new THREE.CylinderGeometry(SHAFT_RADIUS / ARROW_LENGTH, SHAFT_RADIUS / ARROW_LENGTH, shaftLength, 8);
  shaft.translate(0, -0.5 + shaftLength / 2, 0);
  const head = new THREE.ConeGeometry(HEAD_RADIUS / ARROW_LENGTH, headLength, 12);
  head.translate(0, 0.5 - headLength / 2, 0);
  const arrow = mergeGeometries([shaft, head]);
  shaft.dispose();
  head.dispose();
  return arrow;
}

// The electric field of the placed charges as a grid of arrows (see
// fieldArrows.js), all the same length, shaded by strength. Like the field
// lines' arrowheads, they're a single instanced mesh: one arrow geometry
// drawn once per sample, each with its own position, orientation and
// color, in one draw call. sources: [{ position, q }].
export default function FieldArrows({ sources, density }) {
  const arrows = useMemo(
    () => computeFieldArrows(sources, { density, halfExtent: WORLD_HALF_EXTENT }),
    [sources, density],
  );
  const geometry = useMemo(() => makeArrowGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const length = ARROW_LENGTH * arrowSpacing(density, WORLD_HALF_EXTENT);

  const meshRef = useRef();
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const arrowAxis = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(length, length, length);
    const color = new THREE.Color();
    arrows.forEach((arrow, i) => {
      rotation.setFromUnitVectors(arrowAxis, direction.set(...arrow.direction));
      matrix.compose(position.set(...arrow.position), rotation, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.lerpColors(WEAK_COLOR, STRONG_COLOR, arrow.strength));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [arrows, length]);

  if (arrows.length === 0) return null;
  // As with the field lines' arrowheads: a new count means a new mesh, and
  // frustum culling would wrongly use the arrow geometry's own bounds.
  return (
    <instancedMesh key={arrows.length} ref={meshRef} args={[geometry, undefined, arrows.length]} frustumCulled={false}>
      <meshStandardMaterial roughness={0.6} />
    </instancedMesh>
  );
}
