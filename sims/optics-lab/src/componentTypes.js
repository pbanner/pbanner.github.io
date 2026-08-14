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

// Shown under the placement ghost while a component is armed (see App.jsx) --
// most types just get the generic rotate hint below, but a type can override
// it with its own placementMessage where that's not the whole story (e.g.
// the wave plates, which also have an angle beyond their 90°-increment
// rotation).
const DEFAULT_PLACEMENT_MESSAGE = 'After placing, click to\nrotate component.';
const WAVE_PLATE_PLACEMENT_MESSAGE = 'After placing, click to\nrotate component or\nchange angle.';

// footprint is in grid cells at rotation 0 -- {w: 1, h: 1} (a single square)
// unless given otherwise. The laser is the one exception so far: 2 cells
// wide, 1 tall, i.e. it extends across two cells in the same row.
export const COMPONENT_TYPES = [
  { id: 'laser', label: 'Laser', image: laserImage, footprint: { w: 2, h: 1 } },
  { id: 'hwp', label: 'Half-Wave Plate', image: hwpImage, placementMessage: WAVE_PLATE_PLACEMENT_MESSAGE },
  { id: 'qwp', label: 'Quarter-Wave Plate', image: qwpImage, placementMessage: WAVE_PLATE_PLACEMENT_MESSAGE },
  { id: 'mirror', label: 'Mirror', image: mirrorImage },
  { id: 'pbs', label: 'Polarizing Beam Splitter', image: pbsImage },
  { id: 'detector', label: 'Detector', image: detectorImage, footprint: { w: 2, h: 1 } },
];

export function getComponentType(id) {
  return COMPONENT_TYPES.find((c) => c.id === id);
}

// A type's placement-ghost hint -- its own placementMessage if it has one,
// the generic rotate hint otherwise.
export function getPlacementMessage(type) {
  return type.placementMessage ?? DEFAULT_PLACEMENT_MESSAGE;
}

// A type's footprint at rotation 0 -- defaults to a single cell.
export function getDefaultFootprint(type) {
  return type.footprint ?? { w: 1, h: 1 };
}

// A type's footprint at any of the four 90°-increment rotations: unchanged
// at 0°/180°, width/height swapped at 90°/270° (a 2×1 footprint becomes 1×2
// on its side, etc).
export function getRotatedFootprint(type, rotation) {
  const base = getDefaultFootprint(type);
  return rotation === 90 || rotation === 270 ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
}
