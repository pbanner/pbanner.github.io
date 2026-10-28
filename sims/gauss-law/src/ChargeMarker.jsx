import { Billboard, Line } from '@react-three/drei';
import { CHARGE_RADIUS } from './sceneConstants.js';

// One point charge in the scene: a colored sphere with a white + or −
// that always turns to face the camera (drei's Billboard), so the sign is
// readable from any viewing angle. `ghost` draws it translucent, for the
// placement preview; `highlighted` enlarges it slightly (hovered/dragged).
//
// A charge off the floor also gets a dashed drop line straight down (or
// up) to the floor and a shadow disc where that line meets it. On a 2D
// screen a charge floating above one grid point looks just like a charge
// sitting on a different grid point further back; the drop line and
// shadow show which one it actually is.
export default function ChargeMarker({ type, position, ghost = false, highlighted = false }) {
  const barLength = CHARGE_RADIUS * 1.1;
  const barWidth = CHARGE_RADIUS * 0.24;
  // Just in front of the sphere's surface (in the billboard's own frame,
  // +z points at the camera), so the sign isn't hidden inside it.
  const signDepth = CHARGE_RADIUS * 1.02;
  const opacity = ghost ? 0.5 : 1;
  const height = position[2];
  const offFloor = Math.abs(height) > 1e-6;
  return (
    <group position={position}>
      {/* The highlight scales the sphere and its sign together; scaling
          only the sphere would swallow the sign inside it. */}
      <group scale={highlighted ? 1.15 : 1}>
        <mesh>
          <sphereGeometry args={[CHARGE_RADIUS, 32, 32]} />
          <meshStandardMaterial color={type.color} roughness={0.35} metalness={0.05} transparent={ghost} opacity={opacity} depthWrite={!ghost} />
        </mesh>
        <Billboard>
          <mesh position={[0, 0, signDepth]}>
            <planeGeometry args={[barLength, barWidth]} />
            <meshBasicMaterial color="white" transparent={ghost} opacity={opacity} />
          </mesh>
          {type.q > 0 && (
            <mesh position={[0, 0, signDepth]}>
              <planeGeometry args={[barWidth, barLength]} />
              <meshBasicMaterial color="white" transparent={ghost} opacity={opacity} />
            </mesh>
          )}
        </Billboard>
      </group>

      {offFloor && (
        <>
          {/* Group-local coordinates: the floor is at -height below us. */}
          <Line points={[[0, 0, 0], [0, 0, -height]]} color="#555" lineWidth={1.5} dashed dashSize={0.12} gapSize={0.08} />
          <mesh position={[0, 0, -height + 0.003]}>
            <circleGeometry args={[CHARGE_RADIUS * 0.8, 32]} />
            <meshBasicMaterial color="#000" transparent opacity={0.22} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  );
}
