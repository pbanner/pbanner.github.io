// Central list of placeable optics components -- shared between the Build
// panel (icon buttons), the placement ghost (App.jsx), and LabPanel (which
// renders already-placed components). Kept as plain data, no React, so any
// of those three can import it without pulling the others in.

import laserImage from './assets/laser.png';
import hwpImage from './assets/hwp.png';
import qwpImage from './assets/qwp.png';
import mirrorImage from './assets/mirror.png';
import pbsImage from './assets/pbs.png';
import detectorImage from './assets/detector.png';

export const COMPONENT_TYPES = [
  { id: 'laser', label: 'Laser', image: laserImage },
  { id: 'hwp', label: 'Half-Wave Plate', image: hwpImage },
  { id: 'qwp', label: 'Quarter-Wave Plate', image: qwpImage },
  { id: 'mirror', label: 'Mirror', image: mirrorImage },
  { id: 'pbs', label: 'Polarizing Beam Splitter', image: pbsImage },
  { id: 'detector', label: 'Detector', image: detectorImage },
];

export function getComponentType(id) {
  return COMPONENT_TYPES.find((c) => c.id === id);
}
