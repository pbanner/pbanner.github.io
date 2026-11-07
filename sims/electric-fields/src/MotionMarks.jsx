import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { VectorArrow } from './ProbeMarker.jsx';
import { pathInsideBox } from './motion.js';
import { chargeColor } from './chargeTypes.js';
import { fieldStrengthFraction } from './fieldArrows.js';

// What's drawn for a free charge's motion, besides the charge itself
// (ChargeMarker): its velocity and force arrows, its predicted path, and
// its trail during a run.

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

// The force arrow: from the charge's center along the force on it, q E,
// E the field of every other charge (motion.js pushes it with just that
// force) -- along E for a positive charge, against it for a negative one.
// Forces, like fields, span a huge range, so its length is on the same
// logarithmic scale as a field probe's arrow (ProbeMarker.jsx): for a
// 1 nC charge, the force arrow is as long as a probe's arrow would be
// there. In orange.
const FORCE_COLOR = '#e67e22';
const FORCE_ARROW = { shaftRadius: 0.035, headRadius: 0.09, headLength: 0.2 };
const SHORTEST_FORCE_ARROW = 0.4;
const LONGEST_FORCE_ARROW = 1.5;
export function ForceArrow({ position, q, field }) {
  const vector = useMemo(() => {
    const strength = Math.abs(q) * Math.hypot(...field);
    if (!(strength > 0)) return null;
    const length = SHORTEST_FORCE_ARROW + (LONGEST_FORCE_ARROW - SHORTEST_FORCE_ARROW) * fieldStrengthFraction(strength);
    return field.map((e) => (Math.sign(q) * e * length) / Math.hypot(...field));
  }, [q, field]);
  if (!vector) return null;
  return (
    <group position={position}>
      <VectorArrow vector={vector} color={FORCE_COLOR} {...FORCE_ARROW} />
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

// A free charge's trail during a run: the path it's taken so far, up to
// `time`, as a solid line in its own color -- the same path as its
// predicted one, drawn as far as it's got.
export function Trail({ run, index, time, charge }) {
  const pieces = pathInsideBox(run, index, time).filter((piece) => piece.length >= 2);
  return pieces.map((points, k) => (
    <Line key={k} points={points} color={chargeColor(charge)} lineWidth={2.5} />
  ));
}
