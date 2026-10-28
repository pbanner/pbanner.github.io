import { useLayoutEffect, useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { computeFieldLines, arrowheadsAlong } from './fieldLines.js';
import { CHARGE_RADIUS, WORLD_HALF_EXTENT } from './sceneConstants.js';

const LINE_COLOR = '#4a5058';
// About one arrowhead per this many world units of line. Sparse on
// purpose: an arrowhead pointing nearly at or away from the viewer shows
// only its round cross-section, so a dense set reads as scattered dots.
const ARROW_SPACING = 2;
const ARROW_RADIUS = 0.05;
const ARROW_LENGTH = 0.17;

// All arrowheads as one instanced mesh: a single cone geometry drawn once
// per arrow, each with its own position and orientation (its "instance
// matrix"). That's one draw call however many arrows there are, rather
// than one mesh each.
function Arrowheads({ arrows }) {
  const meshRef = useRef();
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const coneAxis = new THREE.Vector3(0, 1, 0); // three's cones point along +y
    const direction = new THREE.Vector3();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    arrows.forEach((arrow, i) => {
      rotation.setFromUnitVectors(coneAxis, direction.set(...arrow.direction));
      matrix.compose(position.set(...arrow.position), rotation, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [arrows]);
  if (arrows.length === 0) return null;
  // The instance count is fixed when the mesh is created, so a new count
  // means a new mesh (key). frustumCulled is off because three would cull
  // using the cone geometry's own bounds, at the origin, rather than where
  // the instances actually are.
  return (
    <instancedMesh key={arrows.length} ref={meshRef} args={[undefined, undefined, arrows.length]} frustumCulled={false}>
      <coneGeometry args={[ARROW_RADIUS, ARROW_LENGTH, 12]} />
      {/* Lit rather than flat, so a cone pointing at the viewer (its shaded
          sides) looks different from one pointing away (its flat base). */}
      <meshStandardMaterial color={LINE_COLOR} roughness={0.6} />
    </instancedMesh>
  );
}

// The electric field lines of the placed charges (see fieldLines.js for
// how they're traced), with arrowheads showing the field's direction.
// sources: [{ position, q }]; recomputed only when they or the density
// setting change, which includes every step of dragging a charge.
export default function FieldLines({ sources, density }) {
  const lines = useMemo(
    () => computeFieldLines(sources, { density, halfExtent: WORLD_HALF_EXTENT, chargeRadius: CHARGE_RADIUS }),
    [sources, density],
  );
  // `segments` mode draws each consecutive pair of points as its own line
  // segment, so every line's consecutive points become pairs: all the
  // lines then go into a single line object (one draw call).
  const segmentPoints = useMemo(() => {
    const points = [];
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) points.push(line[i - 1], line[i]);
    }
    return points;
  }, [lines]);
  const arrows = useMemo(() => arrowheadsAlong(lines, ARROW_SPACING), [lines]);

  if (segmentPoints.length === 0) return null;
  return (
    <group>
      <Line segments points={segmentPoints} color={LINE_COLOR} lineWidth={1.3} />
      <Arrowheads arrows={arrows} />
    </group>
  );
}
