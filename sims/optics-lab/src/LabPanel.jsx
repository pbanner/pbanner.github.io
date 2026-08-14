import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { getComponentType, getDefaultFootprint, getRotatedFootprint, hasAngleControl, hasPowerControl, isPhotonDrawnUnder } from './componentTypes.js';
import { PC_COLORS } from './colors.js';
import WaveplateAngleControl from './WaveplateAngleControl.jsx';
import { SliderPlusTextboxControl } from './controls.jsx';
import { H_STATE, V_STATE, applyJones, hwpMatrix, qwpMatrix, cAbs2 } from './physics.js';

// Side length (px) of one grid square -- also the placed size of a single-
// cell component, and the size of the placement ghost in App.jsx. Larger
// components (see COMPONENT_TYPES' footprint) are placed sized in multiples
// of this.
export const GRID_SIZE = 50;

// Detector card layout. detector.png is byte-identical to the Stern-Gerlach
// sim's PC.png (both 400x200, a 2:1 image). The detector gets the same 6px
// padding every other placed component has (see .placed-component in
// App.css) -- within that padded space the image is fit the same way
// object-fit: contain would fit it, preserving its own 2:1 aspect ratio
// rather than stretching to the padded box's own (wider) one. The values
// below are that resulting on-screen rect: fit-by-height, since the padded
// box is relatively wider than the image, with the leftover width split
// evenly as a letterboxing margin on each side. SG's exact fractional
// stripe/label/count layout then carries over unchanged, just re-expressed
// against this (rather than the full unpadded) box size.
const DETECTOR_PADDING = 6; // matches .placed-component's padding
const DETECTOR_FULL_WIDTH = 2 * GRID_SIZE;
const DETECTOR_FULL_HEIGHT = 1 * GRID_SIZE;
const DETECTOR_PADDED_WIDTH = DETECTOR_FULL_WIDTH - 2 * DETECTOR_PADDING;
const DETECTOR_PADDED_HEIGHT = DETECTOR_FULL_HEIGHT - 2 * DETECTOR_PADDING;
const DETECTOR_BOX_HEIGHT = DETECTOR_PADDED_HEIGHT; // fits by height -- the padded box is wider (proportionally) than the image
const DETECTOR_BOX_WIDTH = DETECTOR_BOX_HEIGHT * 2; // detector.png's own 2:1 aspect ratio
const DETECTOR_OFFSET_X = DETECTOR_PADDING + (DETECTOR_PADDED_WIDTH - DETECTOR_BOX_WIDTH) / 2;
const DETECTOR_OFFSET_Y = DETECTOR_PADDING; // no vertical letterboxing -- fits exactly
const DETECTOR_STRIPE_CENTER_X = 330 * (DETECTOR_BOX_WIDTH / 400);
const DETECTOR_STRIPE_WIDTH = 50 * (DETECTOR_BOX_WIDTH / 400);
const DETECTOR_TEXT_CENTER_X = 190 * (DETECTOR_BOX_WIDTH / 400);
// Distance from the box's top edge to the vertical center of each text
// line (not an offset from the box's own center, unlike the Stern-Gerlach
// sim's PC_LABEL_CENTER_Y/PC_COUNT_CENTER_Y) -- what a translate(-50%,-50%)
// centered element's own `top` needs directly.
const DETECTOR_LABEL_TOP = 50 * (DETECTOR_BOX_HEIGHT / 200);
const DETECTOR_COUNT_TOP = 132 * (DETECTOR_BOX_HEIGHT / 200);

// A mousedown/mouseup pair on a placed component counts as a "click" (select
// it) rather than a drag as long as the cursor never moved more than this
// far in between -- keeps a slightly-shaky click from being misread as an
// intent to move the component.
const CLICK_MOVE_THRESHOLD = 4; // px

// Rotate button: sits just off the selected component's cell, offset by this
// gap -- same idea as the Stern-Gerlach sim's field-overlay anchoring.
const ROTATE_BUTTON_GAP = 8; // px
const ROTATE_BUTTON_SIZE = 26; // px

// WaveplateAngleControl: sits to the right of a selected wave plate's cell.
const WAVEPLATE_CONTROL_GAP = 12; // px

// Laser Power control: sits centered below a selected laser's cell.
const LASER_POWER_CONTROL_WIDTH = 200; // px

// On-canvas angle indicator: how far in (as a % of the component's own
// height) it stays clear of the top/bottom edge, so it never sits flush
// against either one even at the extremes (angle 0 or just under 360).
const WAVEPLATE_INDICATOR_MARGIN_PERCENT = 12;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Keeps a wave plate's angle in [0, 360) regardless of how it got set --
// mirrors WaveplateAngleControl's own copy of this (kept local to each
// file rather than shared, since it's a one-line pure function).
function wrapDegrees(deg) {
  return ((deg % 360) + 360) % 360;
}

let nextId = 1;
function makeComponentId() {
  return `c${nextId++}`;
}
// If weird component bugs persis, can try this alternative:
// function makeComponentId() {
//   return crypto.randomUUID();
// }

// Pixel -> grid-cell conversion, clamped to whatever grid currently fits in
// the canvas. Returns null if the point falls outside the grid entirely.
function cellFromPoint(x, y, cols, rows) {
  const col = Math.floor(x / GRID_SIZE);
  const row = Math.floor(y / GRID_SIZE);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  return { col, row };
}

// Whether two axis-aligned footprints (each in grid-cell units) overlap at all.
function footprintsOverlap(aCol, aRow, aW, aH, bCol, bRow, bW, bH) {
  return aCol < bCol + bW && aCol + aW > bCol && aRow < bRow + bH && aRow + aH > bRow;
}

// Whether a w×h footprint anchored at (col, row) both fits on the current
// grid and doesn't overlap any existing component (other than excludeId --
// used so a component doesn't collide with its own current cells while
// being dragged or rotated).
function isFootprintFree(components, col, row, w, h, excludeId, cols, rows) {
  if (col < 0 || row < 0 || col + w > cols || row + h > rows) return false;
  return !components.some((c) => {
    if (c.id === excludeId) return false;
    const ft = getRotatedFootprint(getComponentType(c.type), c.rotation);
    return footprintsOverlap(col, row, w, h, c.col, c.row, ft.w, ft.h);
  });
}

// Whether comp could rotate 90° clockwise right now, staying anchored at
// its current (col, row). Always true for a square (1×1) footprint -- its
// own cells never change, so isFootprintFree's excludeId always covers it
// -- so this only ever actually blocks a non-square footprint like the
// laser's.
function canRotateComponent(components, comp, cols, rows) {
  const nextRotation = (comp.rotation + 90) % 360;
  const ft = getRotatedFootprint(getComponentType(comp.type), nextRotation);
  return isFootprintFree(components, comp.col, comp.row, ft.w, ft.h, comp.id, cols, rows);
}

// A rotated component is rendered at its *default* (rotation-0) pixel size
// with a plain CSS transform: rotate() -- simplest way to get a correct
// rotation animation/appearance for free. That means the image's own CSS
// box never changes size, so at 90°/270° (where the logical footprint's
// width/height swap) its top-left has to shift by this offset to keep the
// *visible*, rotated box's top-left lined up with the component's actual
// grid anchor (col, row). Works out to (0, 0) for any square (w === h)
// footprint -- i.e. every component except the laser today -- so this only
// actually does anything for non-square footprints.
function getRotationOffset(type, rotation) {
  const base = getDefaultFootprint(type);
  if (rotation !== 90 && rotation !== 270) return { x: 0, y: 0 };
  return {
    x: (base.h - base.w) * GRID_SIZE / 2,
    y: (base.w - base.h) * GRID_SIZE / 2,
  };
}

// --- Photon physics/animation -----------------------------------------
//
// A photon's path is a stochastic walk through the placed components, in
// the same spirit as the Stern-Gerlach sim's samplePath: it samples every
// probabilistic branch (a beamsplitter) via the Born rule and collapses
// state accordingly, and the result is a polyline of vertices -- start,
// one per reflection, and wherever it finally stops -- that the animation
// loop then just walks at a constant speed. Unlike that sim, there's no
// separate "theoretical probability" exact companion here; the histogram
// only ever shows accumulated counts.

const PARTICLE_SPEED = 300; // px/sec, matches the Stern-Gerlach sim's own particles
const PARTICLE_RADIUS = 4;
const PARTICLE_COLOR = '#3498db'; // same blue as .control-bar-button etc.
// Extra straight travel (px), in the same direction, tacked onto an
// unterminated photon's final segment so it visibly continues past the
// canvas edge before being destroyed, rather than stopping right at the
// boundary line.
const ESCAPE_RUN_LENGTH = 70;
// Safety cap on how many components a single photon may interact with --
// guards against a closed loop of mirrors/beamsplitters the student built
// (by accident or otherwise) hanging the animation loop forever.
const MAX_HOPS = 500;

// Laser emission geometry, read directly off laser.png: the small nozzle at
// the barrel's right end -- its actual "opening" -- sits at the unrotated
// image's own right edge, close to vertically centered but for the slight
// letterboxing object-fit: contain gives this wider-than-image footprint
// (see the DETECTOR_* constants above for the same kind of measurement
// against detector.png). LASER_APERTURE_WIDTH is that nozzle's own cross-
// section, converted from image pixels to the footprint's own scale -- the
// "pretty small opening" the emitted beam's transverse jitter is confined
// to, rather than the full 50px height of the placed component.
const LASER_EMIT_LOCAL_X = 87; // px into the unrotated 100px-wide footprint
const LASER_EMIT_LOCAL_Y = 24; // px into the unrotated 50px-tall footprint
const LASER_APERTURE_WIDTH = 15; // px, full spread of the beam's transverse jitter

// Rotates a vector by `deg` clockwise on screen -- the same sense CSS
// transform: rotate(deg) turns a component's own image, so a direction
// vector rotated this way stays in agreement with where the component
// itself visibly points. Rounded to the nearest integer afterward: every
// angle this is ever called with is a multiple of 90°, where cos/sin should
// land exactly on 0/1/-1 but floating point leaves a residue (~1e-16)
// that'd otherwise make a direction's "zero" component compare unequal to 0
// downstream (see samplePhotonPath's dir.x !== 0 checks).
function rotateVec(v, deg) {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return { x: Math.round(v.x * c - v.y * s), y: Math.round(v.x * s + v.y * c) };
}

// Where a laser's beam originates and which cardinal direction it travels
// in, in canvas pixel coordinates. Computed in the component's own
// unrotated local frame (LASER_EMIT_LOCAL_X/Y, direction (1, 0)) and then
// rotated around the unrotated footprint's own center by comp.rotation --
// exactly the transform CSS itself applies to the rendered image (see
// getRotationOffset above), so the beam always leaves from the same point
// the nozzle graphic is actually drawn at, whichever way the laser is
// rotated.
function getLaserEmission(comp) {
  const type = getComponentType(comp.type);
  const base = getDefaultFootprint(type);
  const offset = getRotationOffset(type, comp.rotation);
  const boxX = comp.col * GRID_SIZE + offset.x;
  const boxY = comp.row * GRID_SIZE + offset.y;
  const cx = boxX + (base.w * GRID_SIZE) / 2;
  const cy = boxY + (base.h * GRID_SIZE) / 2;
  const localOffset = { x: LASER_EMIT_LOCAL_X - (base.w * GRID_SIZE) / 2, y: LASER_EMIT_LOCAL_Y - (base.h * GRID_SIZE) / 2 };
  const rotatedOffset = rotateVec(localOffset, comp.rotation);
  const dir = rotateVec({ x: 1, y: 0 }, comp.rotation);
  return { x: cx + rotatedOffset.x, y: cy + rotatedOffset.y, dir };
}

// Every grid cell a placed (non-laser) component's footprint covers, keyed
// "col,row" -> that component -- lets samplePhotonPath's marching loop
// below test cell occupancy in O(1) rather than scanning `components` at
// every step. The laser itself is left out: it's a source, not something a
// photon can hit (including one reflected back into it), so it's simply
// transparent.
function buildCellMap(components) {
  const map = new Map();
  components.forEach((c) => {
    if (c.type === 'laser') return;
    const type = getComponentType(c.type);
    const ft = getRotatedFootprint(type, c.rotation);
    for (let dc = 0; dc < ft.w; dc++) {
      for (let dr = 0; dr < ft.h; dr++) {
        map.set(`${c.col + dc},${c.row + dr}`, c);
      }
    }
  });
  return map;
}

// Which cardinal direction a photon leaves a cell through, given the side
// it exits by -- the inverse of "which side does this direction enter
// through" (computed inline in samplePhotonPath, since it's only needed
// there).
const SIDE_TO_EXIT_DIR = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

// A 1x1 cell's own diagonal "mirror face" pairs up two of its four sides --
// whichever two a beam entering along that diagonal reflects between. Which
// diagonal is active depends only on rotation's parity: y=x (the "\"
// diagonal, corner-to-corner through top-left/bottom-right) at rotation
// 0°/180°, or x+y=GRID_SIZE (the "/" diagonal) at 90°/270° -- see mirror.png
// itself, drawn along "\" at rotation 0. Each diagonal pairs its two
// possible entry/exit combinations one specific way; a mirror only ever
// reflects one of the two, chosen by mirrorReflectivePair below, while a
// beamsplitter (both faces reflective) uses whichever of the two contains
// the actual entry side.
const DIAGONAL_PAIRS_BACKSLASH = [['top', 'right'], ['bottom', 'left']];
const DIAGONAL_PAIRS_SLASH = [['bottom', 'right'], ['top', 'left']];
function diagonalPairs(rotation) {
  return rotation % 180 === 0 ? DIAGONAL_PAIRS_BACKSLASH : DIAGONAL_PAIRS_SLASH;
}
function otherSideInPair(pair, side) {
  return pair[0] === side ? pair[1] : pair[0];
}

// A one-sided mirror: only one of its diagonal's two side-pairs is
// reflective (the "not-dark" face); the other is the dark, absorptive back.
// Which pair is the reflective one turns with the component itself, cycling
// through all four possible pairs as rotation goes 0->90->180->270. This
// table is the result of working the specular-reflection formula d' = d -
// 2(d.n)n through the spec's own worked example (rotation 0: a beam from
// the top reflects right, a beam from the left is absorbed) for a normal
// that rotates along with the mirror -- not an independently chosen rule.
function mirrorReflectivePair(rotation) {
  const pairs = diagonalPairs(rotation);
  return rotation === 0 || rotation === 90 ? pairs[0] : pairs[1];
}
function mirrorOutcome(rotation, entrySide) {
  const reflective = mirrorReflectivePair(rotation);
  if (reflective.includes(entrySide)) {
    return { type: 'reflect', exitSide: otherSideInPair(reflective, entrySide) };
  }
  return { type: 'absorb' };
}

// A two-sided beamsplitter (NPBS or PBS): reflects at the same rotating
// diagonal a mirror would, but for every entry side, not just one pair of
// them -- which of the diagonal's two pairs applies still depends only on
// the entry side itself. The other branch (not computed here -- see
// samplePhotonPath) is always straight-through transmission, independent of
// rotation.
function beamsplitterReflectExit(rotation, entrySide) {
  const pair = diagonalPairs(rotation).find((p) => p.includes(entrySide));
  return otherSideInPair(pair, entrySide);
}

// The exact pixel point where a photon crosses into cell (col, row) --
// where a block/detector absorbs it, or (for the far side, via
// SIDE_TO_EXIT_DIR when it doesn't turn) where it leaves one, on whichever
// edge `dir` enters through, at the same transverse coordinate (`carried`)
// the photon has held since its last actual turn.
function cellEntryPoint(col, row, dir, carried) {
  if (dir.x !== 0) {
    const x = dir.x > 0 ? col * GRID_SIZE : (col + 1) * GRID_SIZE;
    return { x, y: carried.y };
  }
  const y = dir.y > 0 ? row * GRID_SIZE : (row + 1) * GRID_SIZE;
  return { x: carried.x, y };
}
// Where a 1x1 cell's diagonal actually is -- the bend point for a mirror's
// or beamsplitter's reflected branch.
function cellCenter(col, row) {
  return { x: (col + 0.5) * GRID_SIZE, y: (row + 0.5) * GRID_SIZE };
}

// Walks one photon from the laser through the placed components. Returns
// the polyline of vertices it actually traveled (every straight run's
// endpoints) and how it stopped: { type: 'detected', detectorId } | {
// type: 'absorbed' } | { type: 'escaped' } (ran off the canvas, or -- see
// MAX_HOPS -- got stuck in a loop of mirrors/beamsplitters long enough that
// this gives up on it same as if it had escaped).
function samplePhotonPath(laserComp, cellMap, cols, rows) {
  const emission = getLaserEmission(laserComp);
  let dir = emission.dir;
  const jitter = (Math.random() - 0.5) * LASER_APERTURE_WIDTH;
  let pos = dir.x !== 0 ? { x: emission.x, y: emission.y + jitter } : { x: emission.x + jitter, y: emission.y };
  let state = H_STATE; // the laser's own fixed emission polarization
  let col = Math.floor(pos.x / GRID_SIZE);
  let row = Math.floor(pos.y / GRID_SIZE);

  const points = [pos];
  let outcome = { type: 'escaped' };

  hopLoop: for (let hop = 0; hop < MAX_HOPS; hop++) {
    let hitComp;
    for (;;) {
      col += dir.x;
      row += dir.y;
      if (col < 0 || col >= cols || row < 0 || row >= rows) {
        const exitPoint = dir.x !== 0
          ? { x: dir.x > 0 ? cols * GRID_SIZE : 0, y: pos.y }
          : { x: pos.x, y: dir.y > 0 ? rows * GRID_SIZE : 0 };
        points.push(exitPoint);
        outcome = { type: 'escaped' };
        break hopLoop;
      }
      const found = cellMap.get(`${col},${row}`);
      if (found) { hitComp = found; break; }
    }

    const type = getComponentType(hitComp.type);
    const entrySide = dir.x > 0 ? 'left' : dir.x < 0 ? 'right' : dir.y > 0 ? 'top' : 'bottom';

    if (type.physicsKind === 'block') {
      points.push(cellEntryPoint(col, row, dir, pos));
      outcome = { type: 'absorbed' };
      break;
    }
    if (type.physicsKind === 'detector') {
      points.push(cellEntryPoint(col, row, dir, pos));
      outcome = { type: 'detected', detectorId: hitComp.id };
      break;
    }
    if (type.physicsKind === 'hwp' || type.physicsKind === 'qwp') {
      const matrix = type.physicsKind === 'hwp' ? hwpMatrix(hitComp.angle ?? 0) : qwpMatrix(hitComp.angle ?? 0);
      state = applyJones(matrix, state);
      continue; // straight through -- no bend, no new vertex
    }
    if (type.physicsKind === 'mirror') {
      const res = mirrorOutcome(hitComp.rotation, entrySide);
      if (res.type === 'absorb') {
        points.push(cellEntryPoint(col, row, dir, pos));
        outcome = { type: 'absorbed' };
        break;
      }
      pos = cellCenter(col, row);
      points.push(pos);
      dir = SIDE_TO_EXIT_DIR[res.exitSide];
      continue;
    }
    // npbs / pbs: reflect-vs-transmit is a 50/50 coin flip for the
    // polarization-agnostic NPBS, or a Born-rule draw against the current
    // state's own V-amplitude for the PBS (which also collapses state to
    // whichever of H/V that branch corresponds to -- a PBS is a real
    // projective measurement in the H/V basis, unlike the NPBS).
    const reflectExitSide = beamsplitterReflectExit(hitComp.rotation, entrySide);
    const reflectProb = type.physicsKind === 'pbs' ? cAbs2(state.v) : 0.5;
    if (Math.random() < reflectProb) {
      if (type.physicsKind === 'pbs') state = V_STATE;
      pos = cellCenter(col, row);
      points.push(pos);
      dir = SIDE_TO_EXIT_DIR[reflectExitSide];
    } else {
      if (type.physicsKind === 'pbs') state = H_STATE;
      // transmits straight through -- no bend, no new vertex
    }
  }

  return { points, outcome };
}

function segmentLength(seg) {
  return Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
}
function pointOnSegment(seg, t) {
  return { x: seg.x0 + (seg.x1 - seg.x0) * t, y: seg.y0 + (seg.y1 - seg.y0) * t };
}

// Converts a sampled photon's polyline of vertices into the segment list
// the animation loop steps through -- one line segment per consecutive
// vertex pair, plus (only for a photon that ran off the canvas, rather than
// having been absorbed or detected) a short final run further in the same
// direction so it visibly continues past the edge before disappearing,
// instead of stopping right at the boundary.
function buildPhotonSegments(sampled) {
  const { points, outcome } = sampled;
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({ x0: points[i].x, y0: points[i].y, x1: points[i + 1].x, y1: points[i + 1].y });
  }
  if (outcome.type === 'escaped' && segments.length > 0) {
    const last = segments[segments.length - 1];
    const dx = last.x1 - last.x0, dy = last.y1 - last.y0;
    const len = Math.hypot(dx, dy) || 1;
    segments.push({
      x0: last.x1, y0: last.y1,
      x1: last.x1 + (dx / len) * ESCAPE_RUN_LENGTH, y1: last.y1 + (dy / len) * ESCAPE_RUN_LENGTH,
    });
  }
  return { segments, outcome };
}

// Lowest-unused-index color assignment for detectors, same scheme as the
// Stern-Gerlach sim's particle counters -- reused (not re-picked at random)
// whenever a detector is removed, so colors stay stable and predictable as
// detectors come and go.
function getUsedDetectorColorIds(components) {
  const used = new Set();
  components.forEach((c) => {
    if (c.type === 'detector' && c.colorId != null) used.add(c.colorId);
  });
  return used;
}

function getNextDetectorColorId(components) {
  const used = getUsedDetectorColorIds(components);
  for (let i = 0; i < PC_COLORS.length; i++) {
    if (!used.has(i)) return i;
  }
  return null; // more detectors placed at once than the palette has colors
}

// Clockwise rotate glyph (Feather icons' "rotate-cw"): a ~270° arc plus a
// short hooked line at its open end that reads as the arrowhead.
function RotateIcon({ size = 15, color = "#8b0000" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

const LabPanel = forwardRef(function LabPanel({ displayBools, buildMode, setBuildMode, components, setComponents, hoveredDetectorId, setHoveredDetectorId }, ref) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const photonCanvasRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [hoveredCell, setHoveredCell] = useState(null);

  // In-flight photons -- a mutable ref (not React state) updated every
  // animation frame, same reasoning as the Stern-Gerlach sim's own
  // particlesRef: at 60fps this would otherwise mean 60 re-renders/sec.
  const particlesRef = useRef([]);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(null);

  // Existing-component dragging (move-after-placement). dragPos is the
  // component's free-following top-left position in canvas-local pixels
  // while the drag is in progress; the component snaps to a grid cell only
  // once the mouse is released.
  const [draggingId, setDraggingId] = useState(null);
  const [dragPos, setDragPos] = useState(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dragPosRef = useRef(null); // mirrors dragPos, read from the mouseup handler directly
  // Whether the mouse has moved past CLICK_MOVE_THRESHOLD since the current
  // drag started -- distinguishes "clicked to select" from "dragged to move"
  // on mouseup, since both start the same way (mousedown on the component).
  const dragStartClientRef = useRef({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);

  const setDragPosBoth = (pos) => {
    dragPosRef.current = pos;
    setDragPos(pos);
  };

  // Which placed component (by id) is currently selected -- shows the blue
  // cell highlight (same as a drag target) and the rotate button. Only one
  // at a time. Left as-is (not cleared) while build/remove mode is active --
  // selection just goes inert (see selectionActive/selectedComp below) so
  // the rotate button can't float over whatever's being placed/removed, and
  // picks back up right where it was once that mode is left again.
  const [selectedId, setSelectedId] = useState(null);

  // Remove-mode drag-erase is tracked in a ref (not state) since it doesn't
  // need to trigger a re-render by itself -- only the resulting setComponents does.
  const removingRef = useRef(false);

  const cols = Math.max(1, Math.floor(canvasDims.width / GRID_SIZE));
  const rows = Math.max(1, Math.floor(canvasDims.height / GRID_SIZE));

  // Inert (no highlight, no button) while build/remove mode is active or a
  // drag is in progress -- even for a drag of the selected component itself,
  // so the button doesn't have to chase its free-following drag position.
  // It reappears once that mode/drag ends, right where it was.
  const selectionActive = !buildMode && draggingId == null;
  const selectedComp = selectionActive && selectedId != null
    ? components.find((c) => c.id === selectedId)
    : null;

  // Resize canvas (plus the photon layer riding on top of it -- see
  // photonCanvasRef below) to fill container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      canvas.width = newWidth;
      canvas.height = newHeight;
      const photonCanvas = photonCanvasRef.current;
      if (photonCanvas) {
        photonCanvas.width = newWidth;
        photonCanvas.height = newHeight;
      }
      setCanvasDims({ width: newWidth, height: newHeight });
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // Drawing: grid lines plus a highlight over whichever cell the mouse is
  // hovering while placing or removing a component.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = displayBools.gridOn ? '#e0e0e0' : '#ffffff';
    ctx.lineWidth = 1;
    for (let i = 0; i <= canvas.width; i += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(i + 0.5, 0);
      ctx.lineTo(i + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let j = 0; j <= canvas.height; j += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, j + 0.5);
      ctx.lineTo(canvas.width, j + 0.5);
      ctx.stroke();
    }

    // {col, row, w, h}, in grid cells -- covers a multi-cell component's
    // whole footprint, not just one square of it.
    let highlightRect = null;
    let highlightKind = null; // 'place' | 'remove' | 'drag' | 'select'
    if (draggingId != null && dragPos) {
      // Same snap math as the drag's own mouseup handler, so the highlight
      // always matches where the component will actually land.
      const dragged = components.find((c) => c.id === draggingId);
      const ft = dragged ? getRotatedFootprint(getComponentType(dragged.type), dragged.rotation) : { w: 1, h: 1 };
      highlightRect = {
        col: clamp(Math.round(dragPos.x / GRID_SIZE), 0, cols - ft.w),
        row: clamp(Math.round(dragPos.y / GRID_SIZE), 0, rows - ft.h),
        w: ft.w,
        h: ft.h,
      };
      highlightKind = 'drag';
    } else if (hoveredCell && buildMode?.place) {
      const ft = getRotatedFootprint(getComponentType(buildMode.place), 0);
      highlightRect = { col: hoveredCell.col, row: hoveredCell.row, w: ft.w, h: ft.h };
      highlightKind = 'place';
    } else if (hoveredCell && buildMode === 'remove') {
      highlightRect = { col: hoveredCell.col, row: hoveredCell.row, w: 1, h: 1 };
      highlightKind = 'remove';
    } else if (selectedComp) {
      // Selection uses this same cell highlight (rather than a glow on the
      // component itself) so there's no flash-of-blue-then-red as a click
      // transitions from "maybe a drag" (which shows this highlight too)
      // into "just a selection" once mouseup confirms it never moved.
      const ft = getRotatedFootprint(getComponentType(selectedComp.type), selectedComp.rotation);
      highlightRect = { col: selectedComp.col, row: selectedComp.row, w: ft.w, h: ft.h };
      highlightKind = 'select';
    }

    if (highlightRect) {
      let fill;
      if (highlightKind === 'select') {
        fill = 'rgba(52, 152, 219, 0.25)';
      } else {
        // isFootprintFree also catches a footprint that doesn't fit on the
        // grid at all (e.g. a 2-wide laser hovered over the last column) --
        // that reads the same as "occupied" here, both meaning "can't go
        // here." Excludes the dragged component's own id -- its own cells
        // shouldn't read as "occupied" just because it's the thing being moved.
        const free = isFootprintFree(components, highlightRect.col, highlightRect.row, highlightRect.w, highlightRect.h, draggingId, cols, rows);
        if (highlightKind === 'remove') {
          fill = !free ? 'rgba(231, 76, 60, 0.35)' : 'rgba(231, 76, 60, 0.12)';
        } else {
          fill = free ? 'rgba(52, 152, 219, 0.25)' : 'rgba(231, 76, 60, 0.25)';
        }
      }
      ctx.fillStyle = fill;
      ctx.fillRect(highlightRect.col * GRID_SIZE, highlightRect.row * GRID_SIZE, highlightRect.w * GRID_SIZE, highlightRect.h * GRID_SIZE);
    }
  }, [components, canvasDims, displayBools, buildMode, hoveredCell, draggingId, dragPos, cols, rows, selectedComp]);

  const eraseAtClientPos = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cell = cellFromPoint(clientX - rect.left, clientY - rect.top, cols, rows);
    if (!cell) return;
    // Erases whichever component's footprint contains this cell -- a
    // multi-cell component (e.g. the laser) is removed by clicking any of
    // its cells, not just its anchor.
    setComponents((prev) => prev.filter((c) => {
      const ft = getRotatedFootprint(getComponentType(c.type), c.rotation);
      return !footprintsOverlap(cell.col, cell.row, 1, 1, c.col, c.row, ft.w, ft.h);
    }));
  }, [cols, rows, setComponents]);

  // Placement (click to drop an armed component) and remove-mode's initial
  // click both happen on mousedown, so a plain click removes one component
  // while a press-and-drag erases everything the cursor passes over.
  const handleCanvasMouseDown = (e) => {
    if (buildMode === 'remove') {
      removingRef.current = true;
      eraseAtClientPos(e.clientX, e.clientY);
    }
  };

  const handleCanvasClick = (e) => {
    if (buildMode?.place) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const cell = cellFromPoint(e.clientX - rect.left, e.clientY - rect.top, cols, rows);
      if (!cell) return;
      const type = getComponentType(buildMode.place);
      // Capped at one laser -- BuildPanel already disables the Add Laser
      // button once one's placed, but this is the actual enforcement point.
      if (buildMode.place === 'laser' && components.some((c) => c.type === 'laser')) return;
      const ft = getRotatedFootprint(type, 0); // freshly placed, always starts unrotated
      if (!isFootprintFree(components, cell.col, cell.row, ft.w, ft.h, null, cols, rows)) return;
      setComponents((prev) => {
        const newComp = { id: makeComponentId(), type: buildMode.place, col: cell.col, row: cell.row, rotation: 0 };
        if (buildMode.place === 'detector') {
          newComp.colorId = getNextDetectorColorId(prev);
          newComp.count = 0;
        }
        if (hasAngleControl(type)) {
          newComp.angle = 0;
        }
        if (hasPowerControl(type)) {
          newComp.power = 20; // matches the old Data Collection Controls rate slider's own default
        }
        return [...prev, newComp];
      });
      setBuildMode(null); // single-shot placement, same as the Stern-Gerlach sim's build mode
      setSelectedId(null); // a fresh placement always starts deselected, not whatever was selected before
      return;
    }
    // A click that lands on empty canvas (not on a component -- see
    // handleComponentMouseDown, which never lets this fire for those)
    // deselects, same as clicking a selected component a second time.
    if (!buildMode) setSelectedId(null);
  };

  const handleCanvasMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setHoveredCell(cellFromPoint(e.clientX - rect.left, e.clientY - rect.top, cols, rows));
  };

  const handleCanvasMouseLeave = () => setHoveredCell(null);

  // Continue a remove-mode drag-erase even if the mouse briefly leaves the
  // canvas, and always release it on mouseup wherever that happens.
  useEffect(() => {
    if (buildMode !== 'remove') return;
    const onMove = (e) => {
      if (removingRef.current) eraseAtClientPos(e.clientX, e.clientY);
    };
    const onUp = () => {
      removingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [buildMode, eraseAtClientPos]);

  // A placed component's own <img> sits on top of the canvas, so a
  // mousedown that lands on it never reaches handleCanvasMouseDown -- while
  // removing, handle the erase here directly instead of starting a drag.
  const handleComponentMouseDown = (e, comp) => {
    if (buildMode === 'remove') {
      e.stopPropagation();
      removingRef.current = true;
      setComponents((prev) => prev.filter((c) => c.id !== comp.id));
      setSelectedId(null);
      return;
    }
    startDrag(e, comp);
  };

  // Moving an already-placed component: free-follow the cursor, then snap
  // to the nearest grid cell on release (reverting if that cell is taken).
  // A release that never moved past CLICK_MOVE_THRESHOLD is treated as a
  // plain click instead -- see the mouseup handler below.
  const startDrag = (e, comp) => {
    if (buildMode) return; // don't fight with placement/remove mode
    e.stopPropagation();
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    dragOffsetRef.current = {
      x: (e.clientX - rect.left) - comp.col * GRID_SIZE,
      y: (e.clientY - rect.top) - comp.row * GRID_SIZE,
    };
    dragStartClientRef.current = { x: e.clientX, y: e.clientY };
    dragMovedRef.current = false;
    setDraggingId(comp.id);
    setDragPosBoth({ x: comp.col * GRID_SIZE, y: comp.row * GRID_SIZE });
  };

  useEffect(() => {
    if (draggingId == null) return;

    const onMove = (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dx = e.clientX - dragStartClientRef.current.x;
      const dy = e.clientY - dragStartClientRef.current.y;
      if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) dragMovedRef.current = true;
      const rect = canvas.getBoundingClientRect();
      setDragPosBoth({
        x: (e.clientX - rect.left) - dragOffsetRef.current.x,
        y: (e.clientY - rect.top) - dragOffsetRef.current.y,
      });
    };

    // Reads dragPosRef directly rather than a setDragPos functional updater --
    // updater functions must stay pure (React may invoke them speculatively,
    // e.g. under StrictMode), so the setComponents side effect below can't
    // safely live inside one.
    const onUp = () => {
      const pos = dragPosRef.current;
      if (pos) {
        setComponents((prev) => {
          const dragged = prev.find((c) => c.id === draggingId);
          if (!dragged) return prev;
          const ft = getRotatedFootprint(getComponentType(dragged.type), dragged.rotation);
          const col = clamp(Math.round(pos.x / GRID_SIZE), 0, cols - ft.w);
          const row = clamp(Math.round(pos.y / GRID_SIZE), 0, rows - ft.h);
          const free = isFootprintFree(prev, col, row, ft.w, ft.h, draggingId, cols, rows);
          return prev.map((c) => (c.id === draggingId && free ? { ...c, col, row } : c));
        });
      }
      if (dragMovedRef.current) {
        // An actual drag -- the component just moved becomes the selected
        // one, replacing whatever was selected before (if anything).
        setSelectedId(draggingId);
      } else {
        // Never actually dragged -- this was a click. Toggle selection instead
        // (the same component again deselects it, a different one switches to it).
        setSelectedId((prev) => (prev === draggingId ? null : draggingId));
      }
      setDragPosBoth(null);
      setDraggingId(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingId, cols, rows, setComponents]);

  const cursor = buildMode?.place || buildMode === 'remove' ? 'crosshair' : 'default';

  // Rotates the selected component 90° clockwise, staying anchored at its
  // current (col, row) -- so for a non-square footprint (the laser) this
  // can swing the far end into another component, or off the edge of the
  // grid, in a way that was perfectly fine before the rotation. Silently
  // refuses (component stays exactly as it was) rather than allowing that.
  // WPs/PBSs are visually (and eventually optically) identical at 0°/180°,
  // but the rotation state itself still just cycles through all four --
  // no special-casing needed here.
  const rotateSelected = () => {
    setComponents((prev) => {
      const comp = prev.find((c) => c.id === selectedId);
      if (!comp || !canRotateComponent(prev, comp, cols, rows)) return prev;
      return prev.map((c) => (c.id === selectedId ? { ...c, rotation: (c.rotation + 90) % 360 } : c));
    });
  };

  // Detector labels (D1, D2, ...) are derived from placement order among
  // just the detector-type components, not stored on the component itself --
  // recomputed on every render (cheap; components lists here run small).
  const detectorNumbers = new Map();
  let nextDetectorNumber = 1;
  components.forEach((c) => {
    if (c.type === 'detector') detectorNumbers.set(c.id, nextDetectorNumber++);
  });

  // Draws every currently in-flight photon on the dedicated photon layer
  // (see photonCanvasRef) -- cleared and redrawn fresh each frame, same as
  // the Stern-Gerlach sim's own drawParticles.
  const drawPhotons = useCallback((ctx) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = PARTICLE_COLOR;
    particlesRef.current.forEach((p) => {
      const seg = p.segments[p.segmentIndex];
      if (!seg) return;
      const dur = (segmentLength(seg) / PARTICLE_SPEED) * 1000;
      const t = dur > 0 ? Math.min(p.segmentElapsed / dur, 1) : 1;
      const pos = pointOnSegment(seg, t);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, PARTICLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  // tickRef always points at a fresh closure over the current setComponents/
  // drawPhotons -- refreshed after every render (cheap: just a closure
  // allocation) -- so the recursive rAF loop below never reads stale props,
  // however long it's been running. Same reasoning as the Stern-Gerlach
  // sim's own tickRef.
  const tickRef = useRef(null);
  useEffect(() => {
    const canvas = photonCanvasRef.current;
    const ctx = canvas ? canvas.getContext('2d') : null;

    tickRef.current = (now) => {
      if (!ctx) return;
      const dt = lastFrameRef.current ? now - lastFrameRef.current : 0;
      lastFrameRef.current = now;

      const finished = [];
      particlesRef.current.forEach((p) => {
        let remaining = dt;
        while (remaining > 0 && p.segmentIndex < p.segments.length) {
          const seg = p.segments[p.segmentIndex];
          const dur = (segmentLength(seg) / PARTICLE_SPEED) * 1000;
          const left = dur - p.segmentElapsed;
          if (remaining < left) {
            p.segmentElapsed += remaining;
            remaining = 0;
          } else {
            remaining -= left;
            p.segmentIndex += 1;
            p.segmentElapsed = 0;
          }
        }
        if (p.segmentIndex >= p.segments.length) finished.push(p);
      });

      if (finished.length > 0) {
        const detected = finished.filter((p) => p.outcome.type === 'detected');
        if (detected.length > 0) {
          setComponents((prev) => {
            const hits = new Map();
            detected.forEach((p) => hits.set(p.outcome.detectorId, (hits.get(p.outcome.detectorId) ?? 0) + 1));
            return prev.map((c) => (hits.has(c.id) ? { ...c, count: (c.count ?? 0) + hits.get(c.id) } : c));
          });
        }
        particlesRef.current = particlesRef.current.filter((p) => !finished.includes(p));
      }

      drawPhotons(ctx);

      if (particlesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame((n) => tickRef.current(n));
      } else {
        rafRef.current = null;
        lastFrameRef.current = null;
      }
    };
  });

  // Stop the loop if the component unmounts mid-animation
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // Samples and animates one new photon from the (single, capped) placed
  // laser -- a no-op if there isn't one yet. Exposed to App.jsx via ref (see
  // useImperativeHandle below) so the Data Collection panel's "Make One
  // Photon"/"Start" controls, which don't otherwise touch LabPanel's own
  // internals, can drive it.
  const spawnParticle = useCallback(() => {
    const laserComp = components.find((c) => c.type === 'laser');
    if (!laserComp) return;
    const cellMap = buildCellMap(components);
    const sampled = samplePhotonPath(laserComp, cellMap, cols, rows);
    const { segments, outcome } = buildPhotonSegments(sampled);
    if (segments.length === 0) return;
    particlesRef.current = [...particlesRef.current, { segments, outcome, segmentIndex: 0, segmentElapsed: 0 }];
    // The loop only advances itself while already running (see tickRef
    // above) -- if this is the first particle, nothing else will ever
    // notice it exists, so explicitly wake the loop up here.
    if (rafRef.current === null) {
      lastFrameRef.current = null;
      rafRef.current = requestAnimationFrame((now) => tickRef.current(now));
    }
  }, [components, cols, rows]);

  // Clears every in-flight photon -- backs the Data Collection panel's
  // "Reset Data" button (which separately clears detector counts itself,
  // via setComponents, since that's App-level state this ref doesn't need
  // to touch).
  const resetParticles = useCallback(() => {
    particlesRef.current = [];
    const canvas = photonCanvasRef.current;
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useImperativeHandle(ref, () => ({ spawnParticle, resetParticles }), [spawnParticle, resetParticles]);

  const renderComponent = (comp) => {
    const type = getComponentType(comp.type);
    const base = getDefaultFootprint(type);
    const offset = getRotationOffset(type, comp.rotation);
    const isDragging = comp.id === draggingId;
    const anchorX = isDragging && dragPos ? dragPos.x : comp.col * GRID_SIZE;
    const anchorY = isDragging && dragPos ? dragPos.y : comp.row * GRID_SIZE;
    const componentClass = `placed-component ${isDragging ? 'dragging' : ''} ${buildMode === 'remove' ? 'remove-mode' : ''}`;
    const componentStyle = {
      left: anchorX + offset.x,
      top: anchorY + offset.y,
      width: base.w * GRID_SIZE,
      height: base.h * GRID_SIZE,
      transform: `rotate(${comp.rotation}deg)`,
    };

    if (comp.type === 'detector') {
      // Each text element counter-rotates individually (not a shared
      // wrapper around both) so it reads right-side up at 0°/180° --
      // and, left alone (no counter-rotation) at 90°/270°, comes out
      // with its "down" direction pointing left/right respectively,
      // which is exactly the "bottom points left or right" look asked
      // for there. Has to be per-element: label and count each sit off
      // to the side of detector-content's own center, but that center
      // is exactly the *card's* own rotation center too (detector-
      // content is symmetrically inset -- see DETECTOR_OFFSET_X/Y), so
      // a rotation shared by both around that one point would, at
      // 180°, cancel the card's own rotation entirely -- flipping the
      // text's orientation back upright as intended, but *also*
      // flipping its position back to where it sits at 0°, leaving it
      // stranded over whatever part of the now-upside-down image
      // happens to be there instead of following the image the way
      // the stripe does. Rotating each element around its own (small,
      // off-center) box instead only ever spins the glyphs in place;
      // their anchor point still moves whever the card's own rotation
      // carries it, same as the stripe.
      const textRotation = comp.rotation === 180 ? 180 : 0;
      const color = comp.colorId != null ? PC_COLORS[comp.colorId] : '#303030';
      // Chart-hover is a class-driven echo of the same blue glow
      // .placed-component:hover already gives every component for free
      // on a direct mouse-over -- this just lets the histogram's own
      // bar hover (see Histogram.jsx) trigger that same glow here too,
      // and vice versa (see the onMouseEnter/Leave below). Only live
      // outside build/remove mode, per the user's request -- App.jsx
      // also clears hoveredDetectorId the moment build mode is entered,
      // so a hover that was active right as a build button is clicked
      // doesn't linger into it.
      const chartHovered = comp.id === hoveredDetectorId;
      return (
        <div
          key={comp.id}
          className={`${componentClass} detector-component ${chartHovered ? 'chart-hover' : ''}`}
          style={componentStyle}
          onMouseDown={(e) => handleComponentMouseDown(e, comp)}
          onMouseEnter={() => { if (!buildMode) setHoveredDetectorId(comp.id); }}
          onMouseLeave={() => { if (!buildMode) setHoveredDetectorId((prev) => (prev === comp.id ? null : prev)); }}
        >
          {/* Inset by the same 6px padding every other component gets,
              sized to the image's actual rendered rect there (see the
              DETECTOR_* constants) -- everything inside is positioned
              against *this* box, not the full unpadded footprint. */}
          <div
            className="detector-content"
            style={{ left: DETECTOR_OFFSET_X, top: DETECTOR_OFFSET_Y, width: DETECTOR_BOX_WIDTH, height: DETECTOR_BOX_HEIGHT }}
          >
            <img src={type.image} alt={type.label} className="placed-component-image" draggable="false" />
            {comp.colorId != null && (
              <div
                className="detector-stripe"
                style={{
                  left: DETECTOR_STRIPE_CENTER_X - DETECTOR_STRIPE_WIDTH / 2,
                  width: DETECTOR_STRIPE_WIDTH,
                  background: PC_COLORS[comp.colorId],
                }}
              />
            )}
            <div className="detector-text">
              <div
                className="detector-label"
                style={{ left: DETECTOR_TEXT_CENTER_X, top: DETECTOR_LABEL_TOP, transform: `translate(-50%, -50%) rotate(${textRotation}deg)` }}
              >
                {`D${detectorNumbers.get(comp.id)}`}
              </div>
              <div
                className="detector-count"
                style={{ left: DETECTOR_TEXT_CENTER_X, top: DETECTOR_COUNT_TOP, color, transform: `translate(-50%, -50%) rotate(${textRotation}deg)` }}
              >
                {comp.count ?? 0}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (hasAngleControl(type)) {
      // Slides vertically within the component's own body as the angle
      // changes, rather than rotating in place: 0deg sits near the top
      // edge, sweeping down to near the bottom as the angle approaches
      // 360deg, then wrapping back to the top. It's just a normal child
      // of the rotated wrapper below (like the image itself), so it
      // rotates along with the component's own placement rotation --
      // no counter-rotation needed here, unlike the old rotating
      // version (which had to fight the wrapper's rotation to stay in
      // a fixed lab-frame orientation).
      const angleFraction = wrapDegrees(comp.angle ?? 0) / 360;
      const indicatorTopPercent = WAVEPLATE_INDICATOR_MARGIN_PERCENT + angleFraction * (100 - 2 * WAVEPLATE_INDICATOR_MARGIN_PERCENT);
      return (
        <div
          key={comp.id}
          className={`${componentClass} waveplate-component`}
          style={componentStyle}
          onMouseDown={(e) => handleComponentMouseDown(e, comp)}
        >
          <img src={type.image} alt={type.label} className="waveplate-image" draggable="false" />
          <div className="waveplate-indicator" style={{ top: `${indicatorTopPercent}%` }} />
        </div>
      );
    }

    return (
      <img
        key={comp.id}
        src={type.image}
        alt={type.label}
        className={componentClass}
        style={componentStyle}
        draggable="false"
        onMouseDown={(e) => handleComponentMouseDown(e, comp)}
      />
    );
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
        style={{ cursor, display: 'block', touchAction: 'none' }}
      />
      {/* Everything that stops or redirects a photon outside of itself
          (laser/mirror/block/detector) renders here, below the photon
          layer -- then wave plates/beamsplitters render *above* it, so a
          photon passing through or off one of those is drawn underneath its
          (mostly transparent, glass-like) icon rather than on top of it.
          See isPhotonDrawnUnder. */}
      {components.filter((c) => !isPhotonDrawnUnder(getComponentType(c.type))).map(renderComponent)}
      <canvas ref={photonCanvasRef} className="photon-canvas" />
      {components.filter((c) => isPhotonDrawnUnder(getComponentType(c.type))).map(renderComponent)}
      {selectedComp && (() => {
        const ft = getRotatedFootprint(getComponentType(selectedComp.type), selectedComp.rotation);
        const growUp = selectedComp.row > 0;
        const cx = selectedComp.col * GRID_SIZE + (ft.w * GRID_SIZE) / 2;
        const cy = growUp
          ? selectedComp.row * GRID_SIZE - ROTATE_BUTTON_GAP
          : (selectedComp.row + ft.h) * GRID_SIZE + ROTATE_BUTTON_GAP;
        const canRotate = canRotateComponent(components, selectedComp, cols, rows);
        // Sits on the far side of the button from the component -- another
        // ROTATE_BUTTON_SIZE + ROTATE_BUTTON_GAP further out along the same
        // axis and anchor direction the button itself already uses.
        const messageY = growUp
          ? cy - ROTATE_BUTTON_SIZE - ROTATE_BUTTON_GAP
          : cy + ROTATE_BUTTON_SIZE + ROTATE_BUTTON_GAP;
        return (
          <>
            <button
              type="button"
              className="rotate-button"
              aria-label={canRotate ? 'Rotate component 90°' : 'Rotate component 90° -- blocked, another component is in the way.'}
              disabled={!canRotate}
              style={{
                left: cx,
                top: cy,
                width: ROTATE_BUTTON_SIZE,
                height: ROTATE_BUTTON_SIZE,
                transform: growUp ? 'translate(-50%, -100%)' : 'translate(-50%, 0%)',
              }}
              onClick={(e) => { e.stopPropagation(); rotateSelected(); }}
            >
              <RotateIcon color={canRotate ? "#8b0000" : "#8b8b8b"} />
            </button>
            {!canRotate && (
              <div
                className="rotate-blocked-message"
                style={{
                  left: cx,
                  top: messageY,
                  transform: growUp ? 'translate(-50%, -100%)' : 'translate(-50%, 0%)',
                }}
              >
                Another component is in the way,<br />preventing this one from being rotated.
              </div>
            )}
          </>
        );
      })()}
      {selectedComp && hasAngleControl(getComponentType(selectedComp.type)) && (() => {
        const ft = getRotatedFootprint(getComponentType(selectedComp.type), selectedComp.rotation);
        const anchorX = (selectedComp.col + ft.w) * GRID_SIZE + WAVEPLATE_CONTROL_GAP;
        const anchorY = selectedComp.row * GRID_SIZE + (ft.h * GRID_SIZE) / 2;
        return (
          <div className="waveplate-angle-control-anchor" style={{ left: anchorX, top: anchorY }}>
            <WaveplateAngleControl
              angle={selectedComp.angle ?? 0}
              onChangeAngle={(newAngle) => {
                setComponents((prev) => prev.map((c) => (c.id === selectedComp.id ? { ...c, angle: newAngle } : c)));
              }}
            />
          </div>
        );
      })()}
      {selectedComp && hasPowerControl(getComponentType(selectedComp.type)) && (() => {
        const ft = getRotatedFootprint(getComponentType(selectedComp.type), selectedComp.rotation);
        const anchorX = (selectedComp.col + ft.w/2) * GRID_SIZE - LASER_POWER_CONTROL_WIDTH / 2;
        const anchorY = (selectedComp.row + ft.h) * GRID_SIZE + 10;
        return (
          <div className="laser-power-control-anchor" style={{ left: anchorX, top: anchorY }}>
            <div className="laser-power-control" style={{ width: LASER_POWER_CONTROL_WIDTH }}>
              <SliderPlusTextboxControl
                label="Laser Power"
                valueNum={selectedComp.power ?? 20}
                onChangeNum={(newPower) => {
                  setComponents((prev) => prev.map((c) => (c.id === selectedComp.id ? { ...c, power: newPower } : c)));
                }}
                min={0.0}
                max={100}
                step={1.0}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
});

export default LabPanel;