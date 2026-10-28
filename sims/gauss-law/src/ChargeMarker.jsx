import { Billboard } from '@react-three/drei';
import { CHARGE_RADIUS } from './sceneConstants.js';

// One point charge in the scene: a colored sphere with a white + or −
// that always turns to face the camera (drei's Billboard), so the sign is
// readable from any viewing angle. `ghost` draws it translucent, for the
// placement preview.
export default function ChargeMarker({ type, position, ghost = false, highlighted = false }) {
  const barLength = CHARGE_RADIUS * 1.1;
  const barWidth = CHARGE_RADIUS * 0.24;
  // Just in front of the sphere's surface (in the billboard's own frame,
  // +z points at the camera), so the sign isn't hidden inside it.
  const signDepth = CHARGE_RADIUS * 1.02;
  const opacity = ghost ? 0.5 : 1;
  return (
    <group position={position}>
      <mesh scale={highlighted ? 1.15 : 1}>
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
  );
}
