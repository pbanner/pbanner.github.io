// Central list of placeable optics components -- shared between the Build
// panel (icon buttons), the placement ghost (App.jsx), and LabPanel (which
// renders already-placed components). Kept as plain data, no React, so any
// of those three can import it without pulling the others in.

import laserImage from './assets/laser.png';
import hwpImage from './assets/hwp.png';
import qwpImage from './assets/qwp.png';
import mirrorImage from './assets/mirror.png';
import pbsImage from './assets/pbs.png';
import npbsImage from './assets/npbs.png';
import blockImage from './assets/beam-block.png';
import detectorImage from './assets/detector.png';

// Shown under the placement ghost while a component is armed (see App.jsx) --
// most types just get the generic rotate hint below, but a type can override
// it with its own placementMessage where that's not the whole story (e.g.
// the wave plates, which also have an angle beyond their 90°-increment
// rotation).
const DEFAULT_PLACEMENT_MESSAGE = 'After placing, click to\nrotate component.';
const WAVE_PLATE_PLACEMENT_MESSAGE = 'After placing, click to\nrotate component or\nchange angle.';

// footprint is in grid cells at rotation 0 -- {w: 1, h: 1} (a single square)
// unless given otherwise. The laser and detector are the exceptions: 2 cells
// wide, 1 tall, i.e. they extend across two cells in the same row.
//
// Order here is also the Build panel's own icon grid order (see BuildPanel
// in panels.jsx, and .add-component-row's 4-column grid in App.css) -- two
// rows of four: laser/mirror/beam block/detector, then the two wave plates/
// NPBS/PBS.
//
// physicsKind is how LabPanel's photon simulation (samplePhotonPath) tells
// these apart -- it's a separate field from id purely so that dispatch
// reads as "what does this do to a photon" rather than "which build-panel
// button was this", even though today the two happen to line up one-to-one.
export const COMPONENT_TYPES = [
  { id: 'laser', label: 'Laser', image: laserImage, footprint: { w: 2, h: 1 }, hasPower: true, physicsKind: 'laser' },
  { id: 'mirror', label: 'Mirror', image: mirrorImage, physicsKind: 'mirror' },
  { id: 'block', label: 'Beam Block', image: blockImage, physicsKind: 'block' },
  { id: 'detector', label: 'Detector', image: detectorImage, footprint: { w: 2, h: 1 }, physicsKind: 'detector' },
  { id: 'hwp', label: 'Half-Wave Plate', image: hwpImage, placementMessage: WAVE_PLATE_PLACEMENT_MESSAGE, hasAngle: true, physicsKind: 'hwp' },
  { id: 'qwp', label: 'Quarter-Wave Plate', image: qwpImage, placementMessage: WAVE_PLATE_PLACEMENT_MESSAGE, hasAngle: true, physicsKind: 'qwp' },
  { id: 'npbs', label: 'Non-Polarizing Beam Splitter', image: npbsImage, physicsKind: 'npbs' },
  { id: 'pbs', label: 'Polarizing Beam Splitter', image: pbsImage, physicsKind: 'pbs' },
];

// Wave plates and beamsplitters don't stop a photon -- it passes through (or
// off) them coherently, same z-order idea as looking through a pane of
// glass -- so LabPanel draws its photon layer *above* the other component
// types (mirror/block/detector/laser, which either end or redirect a photon
// outside of themselves) but *below* these, rather than always on top.
const PHOTON_UNDER_KINDS = new Set(['hwp', 'qwp', 'npbs', 'pbs']);
export function isPhotonDrawnUnder(type) {
  return PHOTON_UNDER_KINDS.has(type.physicsKind);
}

export function getComponentType(id) {
  return COMPONENT_TYPES.find((c) => c.id === id);
}

// A type's placement-ghost hint -- its own placementMessage if it has one,
// the generic rotate hint otherwise.
export function getPlacementMessage(type) {
  return type.placementMessage ?? DEFAULT_PLACEMENT_MESSAGE;
}

// Whether a type has a continuous optical angle (in addition to its 90°-
// increment placement rotation) -- currently just the wave plates, whose
// fast axis can be set to anything, not just 0/90/180/270. See LabPanel's
// WaveplateAngleControl usage and the comp.angle field it reads/writes.
export function hasAngleControl(type) {
  return !!type.hasAngle;
}
// Whether a type has a Laser Power control -- currently just the laser. See
// LabPanel's use of it and the comp.power field it reads/writes.
export function hasPowerControl(type) {
  return !!type.hasPower;
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
