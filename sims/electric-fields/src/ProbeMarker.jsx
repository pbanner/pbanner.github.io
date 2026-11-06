import { useMemo } from 'react';
import { Billboard, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { AXIS_COLORS, SELECTION_COLOR, WORLD_HALF_EXTENT, CHARGE_RADIUS } from './sceneConstants.js';
import { fieldStrengthFraction } from './fieldArrows.js';
import { fieldLineThrough } from './fieldLines.js';
import { PositionGuides } from './ChargeMarker.jsx';

// Sizes, in world units (1 world unit = 2 cm). The rings sit just outside
// the ball; the selection ring (like a selected point charge's) just
// outside them.
const BALL_RADIUS = 0.125;
const RING_RADIUS = 0.20;
const RING_THICKNESS = 0.015;
const SELECTION_RING = [0.25, 0.28];
const PROBE_COLOR = '#151515';

// The three rings, one parallel to each coordinate plane. A torus is
// built lying in its own xy plane; a quarter turn about y puts it in yz,
// and about x, in xz.
const RING_ROTATIONS = [[0, 0, 0], [0, Math.PI / 2, 0], [Math.PI / 2, 0, 0]];

// The field's arrow runs from the probe's center, from SHORTEST_ARROW
// (weakest field) to LONGEST_ARROW (strongest) long, on the same
// logarithmic scale as the field arrows (fieldArrows.js), so a field
// that's twice as strong always looks the same amount longer.
const SHORTEST_ARROW = 0.4;
const LONGEST_ARROW = 1.5;
const ARROW = { shaftRadius: 0.050, headRadius: 0.12, headLength: 0.25 };
// The components' arrows are thinner, and one shorter than this isn't
// drawn (it's 0, or as good as).
const COMPONENT_ARROW = { shaftRadius: 0.050, headRadius: 0.12, headLength: 0.25 };
const SHORTEST_COMPONENT = 0.05;
// The charges' contributions' arrows, and the longest one can be.
const CONTRIBUTION_ARROW = { shaftRadius: 0.050, headRadius: 0.12, headLength: 0.25 };
const LONGEST_CONTRIBUTION = 1.5;

const UP = new THREE.Vector3(0, 1, 0);

// An arrow from the origin of its parent along `vector` ([x, y, z]),
// drawn as long as the vector itself: a cylinder for the shaft and a cone
// for the head. Both are built pointing along +y and turned to the
// vector's direction. The head is shortened for a very short arrow, so the
// arrow is never longer than its vector.
export function VectorArrow({ vector, color, shaftRadius, headRadius, headLength, opacity = 1 }) {
  const length = Math.hypot(...vector);
  const quaternion = useMemo(() => {
    const direction = new THREE.Vector3(...vector).normalize();
    return new THREE.Quaternion().setFromUnitVectors(UP, direction);
  }, [vector]);
  if (!(length > 0)) return null;
  const head = Math.min(headLength, length / 2);
  const shaft = length - head;
  const transparent = opacity < 1;
  return (
    <group quaternion={quaternion}>
      <mesh position={[0, shaft / 2, 0]}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaft, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} transparent={transparent} opacity={opacity} depthWrite={!transparent} />
      </mesh>
      <mesh position={[0, shaft + head / 2, 0]}>
        <coneGeometry args={[headRadius * (head / headLength), head, 16]} />
        <meshStandardMaterial color={color} roughness={0.5} transparent={transparent} opacity={opacity} depthWrite={!transparent} />
      </mesh>
    </group>
  );
}

// How long a probe's arrow is for a field of the given strength.
function arrowLength(magnitude) {
  return SHORTEST_ARROW + (LONGEST_ARROW - SHORTEST_ARROW) * fieldStrengthFraction(magnitude);
}

// One field probe in the scene: a small black ball circled by three thin
// rings, with a thick arrow from its center along the field there, and its
// letter beside it.
//
// reading: probes.js's probeReading at the probe -- { field } or, where the
// field has no single value, { undefinedOn }, and then there's no arrow.
// `ghost` draws it translucent, for the placement preview (with the arrow,
// so the field can be read before it's dropped, and without a letter);
// `highlighted` enlarges it slightly (hovered or dragged); `selected`
// circles it with a blue ring that faces the camera; `showGuides` adds the
// PositionGuides, while it's being placed or dragged.
//
// `showComponents` adds the field's x, y and z components as thinner
// arrows from the center, in the axes' colors. They're drawn on the same
// scale as the field's arrow -- each as long as the arrow times its share
// of the field -- so, laid tip to tail, they'd make up the arrow exactly.
//
// `contributions` ([{ id, field, color }], or null) are each charge's own
// field at the probe, drawn as arrows from the center in its color (red
// positive, blue negative) -- superposition: they add up to the field's
// arrow, so they're drawn on its scale too. But they can be far stronger
// than the field they add up to (two charges' fields nearly canceling),
// so that scale is shrunk, if need be, for the longest of them to be
// LONGEST_CONTRIBUTION long; the field's arrow is then shorter than usual,
// and where the field vanishes altogether, there's no arrow at all, just
// the contributions canceling.
export default function ProbeMarker({ position, label = null, reading, ghost = false, highlighted = false, selected = false, showGuides = false, showComponents = false, contributions = null }) {
  const opacity = ghost ? 0.5 : 1;
  const field = reading?.field;
  const magnitude = field ? Math.hypot(...field) : 0;
  // How long a drawn arrow is per unit of field.
  const largest = contributions ? Math.max(0, ...contributions.map((c) => Math.hypot(...c.field))) : 0;
  let scale = magnitude > 0 ? arrowLength(magnitude) / magnitude : Infinity;
  if (largest > 0) scale = Math.min(scale, LONGEST_CONTRIBUTION / largest);
  if (!Number.isFinite(scale)) scale = 0;
  const arrow = useMemo(() => (scale > 0 ? field.map((c) => c * scale) : null), [field, scale]);
  const components = useMemo(() => {
    if (!showComponents || !(scale > 0)) return [];
    return [0, 1, 2]
      .map((k) => ({ k, vector: [0, 1, 2].map((j) => (j === k ? field[k] * scale : 0)) }))
      .filter(({ vector, k }) => Math.abs(vector[k]) >= SHORTEST_COMPONENT);
  }, [showComponents, field, scale]);
  return (
    <>
      <group position={position}>
        <group scale={highlighted ? 1.15 : 1}>
          <mesh>
            <sphereGeometry args={[BALL_RADIUS, 24, 24]} />
            <meshStandardMaterial color={PROBE_COLOR} roughness={0.4} transparent={ghost} opacity={opacity} depthWrite={!ghost} />
          </mesh>
          {RING_ROTATIONS.map((rotation, i) => (
            <mesh key={i} rotation={rotation}>
              <torusGeometry args={[RING_RADIUS, RING_THICKNESS, 8, 48]} />
              <meshStandardMaterial color={PROBE_COLOR} roughness={0.4} transparent={ghost} opacity={opacity} depthWrite={!ghost} />
            </mesh>
          ))}
        </group>
        {arrow && <VectorArrow vector={arrow} color={PROBE_COLOR} opacity={opacity} {...ARROW} />}
        {components.map(({ k, vector }) => (
          <VectorArrow key={k} vector={vector} color={AXIS_COLORS[k]} opacity={opacity} {...COMPONENT_ARROW} />
        ))}
        {scale > 0 && contributions?.map((c) => {
          const vector = c.field.map((v) => v * scale);
          return Math.hypot(...vector) >= SHORTEST_COMPONENT && <VectorArrow key={c.id} vector={vector} color={c.color} {...CONTRIBUTION_ARROW} />;
        })}
        {selected && (
          <Billboard>
            <mesh>
              <ringGeometry args={[SELECTION_RING[0], SELECTION_RING[1], 48]} />
              <meshBasicMaterial color={SELECTION_COLOR} />
            </mesh>
          </Billboard>
        )}
        {/* The letter, as ordinary text beside the probe (drei's Html
            keeps it over the probe's spot on screen). Its z-index range
            keeps it under the overlay panels. */}
        {label && (
          <Html zIndexRange={[5, 0]} pointerEvents="none">
            <div className={`probe-label${selected ? ' selected' : ''}`}>{label}</div>
          </Html>
        )}
      </group>
      {showGuides && <PositionGuides position={position} />}
    </>
  );
}

// The field line through a probe (fieldLines.js's fieldLineThrough), in
// the probe's color and thicker than the other field lines, so it stands
// out among them; the probe's arrow lies along it. Traced again only when
// the probe or the charges move. sources: everything charged. cut: the 2D
// cut while it's viewed (the line is held in it), or null.
export function ProbeFieldLine({ position, sources, cut = null }) {
  const points = useMemo(
    () => fieldLineThrough(position, sources, { halfExtent: WORLD_HALF_EXTENT, chargeRadius: CHARGE_RADIUS, cut }),
    [position, sources, cut],
  );
  if (!points) return null;
  return <Line points={points} color={PROBE_COLOR} lineWidth={3} />;
}
