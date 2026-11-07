import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { VectorArrow } from './ProbeMarker.jsx';
import { pathInsideBox } from './motion.js';
import { chargeColor } from './chargeTypes.js';

// What's drawn for a free charge's motion, besides the charge itself
// (ChargeMarker): its predicted path and its velocity arrow.

// The velocity arrow: from the charge's center along its velocity, 1 world
// unit long per world unit per second -- so 1 cm per cm/s, and its tip is
// where the charge would be a second later if it kept going as it is. In
// purple, apart from the charges' red and blue, the axes' colors, a
// probe's black and the selection blue.
const VELOCITY_COLOR = '#8e44ad';
const VELOCITY_ARROW = { shaftRadius: 0.035, headRadius: 0.09, headLength: 0.2 };
export function VelocityArrow({ position, velocity }) {
  return (
    <group position={position}>
      <VectorArrow vector={velocity} color={VELOCITY_COLOR} {...VELOCITY_ARROW} />
    </group>
  );
}

// A free charge's predicted path: where the run (motion.js's simulateRun)
// takes it, as a dashed line in its own color, from where it starts to
// wherever the run ends -- leaving out the parts outside the box, where it
// isn't seen. run: the run; index: the charge's place in run.ids; charge:
// the charge itself, for its color.
export function PredictedPath({ run, index, charge }) {
  // The same throughout a run, so worked out once for it.
  const pieces = useMemo(() => pathInsideBox(run, index).filter((piece) => piece.length >= 2), [run, index]);
  return pieces.map((points, k) => (
    <Line key={k} points={points} color={chargeColor(charge)} lineWidth={2} dashed dashSize={0.15} gapSize={0.1} />
  ));
}
