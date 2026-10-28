import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { computeFieldArrows, arrowSpacing } from './fieldArrows.js';
import { WORLD_HALF_EXTENT } from './sceneConstants.js';

// Arrow shades: strongest field darkest (the field lines' color), weakest
// a light gray that still stands out against the background.
const STRONG_COLOR = new THREE.Color('#2f343b');
const WEAK_COLOR = new THREE.Color('#c2c8d0');

// Arrow proportions, as fractions of the spacing between arrows. The
// length runs from SHORTEST_ARROW (weakest field) to LONGEST_ARROW
// (strongest) on the same scale as the shade, so neighbors never touch;
// the head and the shaft's thickness stay the same at every length, so
// even the shortest arrow's direction is easy to read.
const SHORTEST_ARROW = 0.3;
const LONGEST_ARROW = 0.9;
const SHAFT_RADIUS = 0.018;
const HEAD_RADIUS = 0.06;
const HEAD_LENGTH = 0.2;

// The two parts of an arrow, each pointing along +y and starting at the
// origin: a shaft of length 1 (stretched to each arrow's length) and a
// head of fixed length (placed at each arrow's tip).
function makeShaftGeometry() {
  return new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, 1, 8).translate(0, 0.5, 0);
}
function makeHeadGeometry() {
  return new THREE.ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 12).translate(0, HEAD_LENGTH / 2, 0);
}

// The electric field of the placed charges as a grid of arrows (see
// fieldArrows.js), longer and darker where the field is stronger. Like the
// field lines' arrowheads, they're instanced meshes: one geometry drawn
// once per sample, each with its own position, orientation, size and
// color, in one draw call. Shafts and heads are separate meshes, since a
// shaft stretches with its arrow's length but a head doesn't, and an
// instance can only stretch its whole geometry. sources: [{ position, q }].
export default function FieldArrows({ sources, density }) {
  const arrows = useMemo(
    () => computeFieldArrows(sources, { density, halfExtent: WORLD_HALF_EXTENT }),
    [sources, density],
  );
  const shaftGeometry = useMemo(() => makeShaftGeometry(), []);
  const headGeometry = useMemo(() => makeHeadGeometry(), []);
  useEffect(() => () => shaftGeometry.dispose(), [shaftGeometry]);
  useEffect(() => () => headGeometry.dispose(), [headGeometry]);
  const spacing = arrowSpacing(density, WORLD_HALF_EXTENT);

  const shaftsRef = useRef();
  const headsRef = useRef();
  useLayoutEffect(() => {
    const shafts = shaftsRef.current;
    const heads = headsRef.current;
    if (!shafts || !heads) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const arrowAxis = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    const tail = new THREE.Vector3();
    const headBase = new THREE.Vector3();
    const shaftScale = new THREE.Vector3();
    const headScale = new THREE.Vector3(spacing, spacing, spacing);
    const color = new THREE.Color();
    arrows.forEach((arrow, i) => {
      // In units of the spacing: the whole arrow, and its shaft.
      const length = SHORTEST_ARROW + (LONGEST_ARROW - SHORTEST_ARROW) * arrow.strength;
      const shaftLength = length - HEAD_LENGTH;
      direction.set(...arrow.direction);
      rotation.setFromUnitVectors(arrowAxis, direction);
      // Centered on the sample point: the tail half a length behind it.
      tail.set(...arrow.position).addScaledVector(direction, (-length / 2) * spacing);
      headBase.copy(tail).addScaledVector(direction, shaftLength * spacing);
      // The shaft is stretched only along its own axis (y), so it gets
      // longer without getting thicker.
      matrix.compose(tail, rotation, shaftScale.set(spacing, shaftLength * spacing, spacing));
      shafts.setMatrixAt(i, matrix);
      matrix.compose(headBase, rotation, headScale);
      heads.setMatrixAt(i, matrix);
      color.lerpColors(WEAK_COLOR, STRONG_COLOR, arrow.strength);
      shafts.setColorAt(i, color);
      heads.setColorAt(i, color);
    });
    for (const mesh of [shafts, heads]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [arrows, spacing]);

  if (arrows.length === 0) return null;
  // As with the field lines' arrowheads: a new count means new meshes, and
  // frustum culling would wrongly use one arrow part's own bounds.
  return (
    <group key={arrows.length}>
      <instancedMesh ref={shaftsRef} args={[shaftGeometry, undefined, arrows.length]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={headsRef} args={[headGeometry, undefined, arrows.length]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
    </group>
  );
}
