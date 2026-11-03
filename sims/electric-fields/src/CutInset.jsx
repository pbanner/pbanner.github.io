import { useLayoutEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import ChargedObject from './ChargedObject.jsx';
import CutPlane from './CutPlane.jsx';
import { chargeColor } from './chargeTypes.js';
import { WORLD_HALF_EXTENT, INITIAL_CAMERA_POSITION, CAMERA_FOV } from './sceneConstants.js';

// While the 2D cut is shown, a small 3D picture of where it is takes the
// axis gizmo's place in the lower-left corner: the box, seen from the
// default viewpoint, with the cut and the charges in it. Clicking it goes
// back to 3D. It's its own little canvas, drawn only when something in it
// changes (frameloop="demand"), not every frame like the main view.

const H = WORLD_HALF_EXTENT;
const INSET_CHARGE_RADIUS = 0.45; // point charges, drawn big enough to see at this size

// The box's twelve edges, as pairs of corners.
const BOX_EDGES = (() => {
  const corners = [];
  for (const x of [-H, H]) for (const y of [-H, H]) for (const z of [-H, H]) corners.push([x, y, z]);
  const edges = [];
  corners.forEach((a, i) => corners.forEach((b, j) => {
    // Neighboring corners differ in exactly one coordinate.
    if (j > i && a.filter((v, k) => v !== b[k]).length === 1) edges.push(a, b);
  }));
  return edges;
})();

// The default camera looks along -z; aim it at the middle of the box.
function AimCamera() {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    camera.lookAt(0, 0, 0);
  }, [camera]);
  return null;
}

// charges: everything placed. cut: where the cut is (cutPlanes.js's
// placeCut). onClick: back to 3D.
export default function CutInset({ charges, cut, onClick }) {
  return (
    <button type="button" className="cut-inset" onClick={onClick} title="Back to 3D" aria-label="Back to 3D">
      <Canvas frameloop="demand" camera={{ position: INITIAL_CAMERA_POSITION, up: [0, 0, 1], fov: CAMERA_FOV }}>
        <AimCamera />
        <ambientLight intensity={1.4} />
        <directionalLight position={INITIAL_CAMERA_POSITION} intensity={1.6} />
        <Line segments points={BOX_EDGES} color="#9aa0a8" lineWidth={1} />
        <CutPlane cut={cut} charges={[]} />
        {charges.map((c) => (c.kind === 'point' ? (
          <mesh key={c.id} position={c.position}>
            <sphereGeometry args={[INSET_CHARGE_RADIUS, 16, 12]} />
            <meshStandardMaterial color={chargeColor(c.q)} />
          </mesh>
        ) : (
          <ChargedObject key={c.id} charge={c} />
        )))}
      </Canvas>
    </button>
  );
}
