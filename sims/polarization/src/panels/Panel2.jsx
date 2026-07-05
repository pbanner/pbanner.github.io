import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sphere } from '@react-three/drei';

export default function Panel2() {
  return (
    <Canvas camera={{ position: [3, 2, 3] }}>
      <ambientLight intensity={0.6} />
      <pointLight position={[5, 5, 5]} />
      <Sphere args={[1, 32, 32]}>
        <meshStandardMaterial wireframe color="steelblue" />
      </Sphere>
      <OrbitControls />
    </Canvas>
  );
}