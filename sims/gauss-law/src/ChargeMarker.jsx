import { useEffect, useMemo } from 'react';
import { Billboard, Line } from '@react-three/drei';
import { CanvasTexture } from 'three';
import { CHARGE_RADIUS } from './sceneConstants.js';
import { chargeGuideSegments } from './geometry.js';
import { chargeColor, chargeSignText } from './chargeTypes.js';

const FOOT_DOT_RADIUS = 0.06;

// A charge bigger than one unit is labeled with its value ("+3", "−2")
// instead of a bare sign: white text drawn into a canvas, used as the
// texture of a sprite (a flat picture that always faces the camera; the
// axis gizmo's labels are drawn the same way). The canvas is twice as wide
// as tall, to fit two characters.
const LABEL_CANVAS_HEIGHT = 64;
function useChargeLabelTexture(q) {
  const texture = useMemo(() => {
    if (Math.abs(q) === 1) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 2 * LABEL_CANVAS_HEIGHT;
    canvas.height = LABEL_CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.font = `900 ${0.85 * LABEL_CANVAS_HEIGHT}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.fillText(chargeSignText(q), canvas.width / 2, canvas.height / 2 + 2);
    const t = new CanvasTexture(canvas);
    t.anisotropy = 4;
    return t;
  }, [q]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

// One point charge in the scene: a colored sphere (red positive, blue
// negative) with a white + or − -- or its value, if it's more than one
// unit -- that always turns to face the camera (drei's Billboard), so the
// sign is readable from any viewing angle. `ghost` draws it translucent, for the
// placement preview; `highlighted` enlarges it slightly (hovered/dragged).
//
// `showGuides` (while the charge is being placed or dragged) adds black
// dashed coordinate guides (see chargeGuideSegments): a drop line to the
// charge's foot on the xy plane, marked with a black dot; lines from the
// foot to the x and y axes; and a line from the charge to the z axis. On a
// 2D screen a charge floating above one point looks just like a charge
// sitting at a different point further back; the guides show which one it
// actually is, and read its x, y and z off the axis ticks. They're hidden
// otherwise to keep the scene uncluttered.
export default function ChargeMarker({ q, position, ghost = false, highlighted = false, showGuides = false }) {
  const barLength = CHARGE_RADIUS * 1.1;
  const barWidth = CHARGE_RADIUS * 0.24;
  // Just in front of the sphere's surface (in the billboard's own frame,
  // +z points at the camera), so the sign isn't hidden inside it.
  const signDepth = CHARGE_RADIUS * 1.02;
  const opacity = ghost ? 0.5 : 1;
  const labelTexture = useChargeLabelTexture(q);
  const [x, y, z] = position;
  const guideSegments = showGuides ? chargeGuideSegments(position) : [];
  // A charge on the xy plane covers its own foot, so it gets no dot.
  const showFootDot = showGuides && Math.abs(z) > 1e-9;
  return (
    <>
      <group position={position}>
        {/* The highlight scales the sphere and its sign together; scaling
            only the sphere would swallow the sign inside it. */}
        <group scale={highlighted ? 1.15 : 1}>
          <mesh>
            <sphereGeometry args={[CHARGE_RADIUS, 32, 32]} />
            <meshStandardMaterial color={chargeColor(q)} roughness={0.35} metalness={0.05} transparent={ghost} opacity={opacity} depthWrite={!ghost} />
          </mesh>
          <Billboard>
            {labelTexture ? (
              <sprite position={[0, 0, signDepth]} scale={[2 * CHARGE_RADIUS * 0.95, CHARGE_RADIUS * 0.95, 1]}>
                <spriteMaterial map={labelTexture} transparent opacity={opacity} alphaTest={0.1} toneMapped={false} />
              </sprite>
            ) : (
              <>
                <mesh position={[0, 0, signDepth]}>
                  <planeGeometry args={[barLength, barWidth]} />
                  <meshBasicMaterial color="white" transparent={ghost} opacity={opacity} />
                </mesh>
                {q > 0 && (
                  <mesh position={[0, 0, signDepth]}>
                    <planeGeometry args={[barWidth, barLength]} />
                    <meshBasicMaterial color="white" transparent={ghost} opacity={opacity} />
                  </mesh>
                )}
              </>
            )}
          </Billboard>
        </group>
      </group>

      {/* The guides sit outside the positioned group, so their endpoints are
          plain world coordinates. `segments` draws each consecutive pair of
          points as its own separate line. */}
      {guideSegments.length > 0 && (
        <Line segments points={guideSegments.flat()} color="#000" lineWidth={1.5} dashed dashSize={0.12} gapSize={0.08} />
      )}
      {showFootDot && (
        <mesh position={[x, y, 0]}>
          <sphereGeometry args={[FOOT_DOT_RADIUS, 16, 16]} />
          <meshBasicMaterial color="#000" />
        </mesh>
      )}
    </>
  );
}
