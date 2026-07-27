import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { upEigenstate, downEigenstate, applyT, sampleOvenState, cAbs2, theoreticalProbabilities } from './physics';
import { PC_COLORS } from './colors';
import { arrowWidth, drawArrow } from './canvasArrow';
import sgImage from './assets/SG.png';
import pcImage from './assets/PC.png';
import bbImage from './assets/BB.png';
import ovenImage from './assets/oven.png';
import ovenOffImage from './assets/ovenOff.png';

// Oven dimensions for rescaling here
const OVEN_HEIGHT = 100;
const OVEN_WIDTH = Math.round(OVEN_HEIGHT*(992/654));
const OVEN_X0 = 50;
// SG image dimensions and specs for use throughout
const SG_WIDTH = 160;
const SG_HEIGHT = 90;
const SG_SPACING = 300;   // horizontal gap between apparatus centers
const SG_START_X = 300;   // x-position of the first apparatus
// From the image itself, to be used for path drawing
const SG_INPUT_Y = 111*(SG_HEIGHT/225);
const SG_OUTPUT_UP = 66*(SG_HEIGHT/225);
const SG_OUTPUT_DOWN = 158*(SG_HEIGHT/225);
// PC image dimensions and specs for use throughout
const PC_HEIGHT = 50;
const PC_WIDTH = 100;
//const PC_INPUT = PC_HEIGHT/2;
// Identifying color stripe -- runs the PC's whole short (vertical)
// dimension, in place of the small dot that used to sit here, so the color
// that ties this detector to its histogram bar is hard to miss while
// placing it. Kept at the old dot's x and diameter; the source image is
// fully opaque across that band top to bottom, so a full-height rect never
// overhangs the body's rounded corners.
const PC_STRIPE_CENTER_X = 330*(PC_WIDTH/400);
const PC_STRIPE_WIDTH = 50*(PC_WIDTH/400);
const PC_STRIPE_ALPHA = 0.5;
const PC_TEXT_CENTER_X = 190*(PC_WIDTH/400);
const PC_ALT_TEXT_CENTER_X = 200*(PC_WIDTH/400);
// The white label plate spans y 93..166 of the source image's 200px
// height: the running count sits centered in it, and the SG/arm label goes
// in the clear space above it (centered between the body top and y=93).
const PC_COUNT_CENTER_Y = 132*(PC_HEIGHT/200) - PC_HEIGHT/2;
const PC_LABEL_CENTER_Y = 50*(PC_HEIGHT/200) - PC_HEIGHT/2;
const PC_HIGHLIGHT_PADDING = 6;
const PC_HIGHLIGHT_LINE_WIDTH = 3;
const BB_HEIGHT = 50;
const BB_WIDTH = 9;
//const BB_INPUT = BB_HEIGHT/2;

// Theory-probability bar meter (theoryScreenshotToggle, Shift+P in App) --
// drawn in place of a placed particle counter's image+running-count, in the
// same PC_WIDTH x PC_HEIGHT footprint so no placement/site geometry has to
// change to support it.
const THEORY_BAR_CARD_MULTIPLIER = 1.2;  // The factor by which the card is larger than the PC footprint
const THEORY_BAR_HEIGHT = 16;
const THEORY_BAR_MARGIN = 10;
const THEORY_BAR_X0 = THEORY_BAR_MARGIN;
const THEORY_BAR_WIDTH = PC_WIDTH - 2 * THEORY_BAR_MARGIN;
const THEORY_BAR_Y0 = PC_HEIGHT*((1 - THEORY_BAR_CARD_MULTIPLIER) + 0.5) - THEORY_BAR_HEIGHT/2;

// Path specs for particles
// In path constrained by SG spacing and geometry. The arc must satisfy two
// constraints at once -- horizontal run R*sin(angle) = D and vertical rise
// R*(1-cos(angle)) = h -- and dividing those gives tan(angle/2) = h/D, not
// tan(angle) = h/D. Using atan() directly (without the factor of 2) solves
// only the x-constraint, leaving the y-endpoint short of the next SG's
// input by a few px -- the small vertical jump.
const IN_PATH_ARC_ANGLE = 2 * Math.atan(Math.abs(SG_INPUT_Y - SG_OUTPUT_UP)/Math.abs(SG_SPACING - SG_WIDTH));
const IN_PATH_ARC_RADIUS = Math.abs(SG_SPACING - SG_WIDTH)/Math.sin(IN_PATH_ARC_ANGLE);
// Out path not constrained, radius and angle chosen for aesthetics
const OUT_PATH_ARC_RADIUS = 150;
const OUT_PATH_ARC_ANGLE = 0.7; // rad

// For placement and deletion snapping and finding -- shared by delete-mode's
// target highlight and build-mode's site circles, so hitbox size always
// matches the circle actually drawn on screen.
const SITE_MARGIN = 1.3; // multiplier on half-the-longest-dimension

// Particle animation specs -- all tunable
const PARTICLE_START_X = OVEN_X0 + OVEN_WIDTH;     // x-value where particles first appear
const PARTICLE_SPEED = 300;        // px/sec while visibly moving
const SG_PROCESSING_MS = 200;      // fixed pause while "inside" an SG
const BEAM_TRANSVERSE_WIDTH = 14;  // px, full spread of the (uniform) beam jitter
const PARTICLE_RADIUS = 4;
const PARTICLE_COLOR = '#3498db';  // same blue as .control-bar-button etc.
const ESCAPE_RUN_LENGTH = 1200;    // px of straight travel for a particle that exits the chain unmeasured

const ERROR_TEXT_MAX_WIDTH = 200;  // px -- how far the wrapped warning text may run horizontally
const ERROR_TEXT_LINE_HEIGHT = 18; // px between wrapped lines
const ERROR_TEXT_GAP = 14;         // px between a warning circle's edge and its text

const SUB_LABELS = "₁₂₃₄₅₆₇₈₉";
function getSGLabel(angles, id) {
  if (angles[0] == 0) {
    return 'Z';
  } else if (angles[0] == Math.PI/2) {
    if (angles[1] == 0) {
      return 'X';
    } else if (angles[1] == Math.PI/2) {
      return 'Y';
    }
  }
  return 'n̂'+SUB_LABELS[id];
}

function useImage(src) {
  const imgRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // There's a lint error here, but the dependency, src, is static, so 
    // the setting won't cause the re-render that's warned about
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(false);
    imgRef.current = null;

    const img = new Image();
    img.src = src;
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      setLoaded(true);
    };

    return () => {
      cancelled = true;
    };
  }, [src]);

  return [imgRef, loaded];
}
// The five images (oven, ovenOff, sg, pc, bb) load independently and in no
// guaranteed order -- ctx.drawImage throws a TypeError, uncaught all the
// way up through React (no error boundary here), if handed a ref whose
// image hasn't loaded yet (imgRef.current is still null). Every drawImage
// call needs to check *its own* image's readiness, not some other image's,
// or a slow/unlucky load order crashes the whole canvas until reload.
function imageReady(imgRef) {
  return imgRef.current !== null && imgRef.current.complete;
}

// This is the fundemantal function of the first part of the animation pipeline!!!
// Walk the SG chain for one particle. A real measurement (and thus
// collapse) occurs only at an SG where at least one arm terminates (PC or
// BB) -- an SG with both arms open is transparent, and the state passes
// through unchanged, preserving coherence for later interference.
// Returns a set of hops (up or down) using the available physics.
function samplePath(experiment) {
  const hops = [];
  let state = sampleOvenState();

  for (let sgIndex = 0; sgIndex < experiment.length; sgIndex++) {
    const sg = experiment[sgIndex];
    const [theta, phi] = sg.basis;

    if (sg.up === null && sg.down === null) {
      const { up } = applyT(theta, phi, state);
      const arm = Math.random() < cAbs2(up) ? 'up' : 'down'; // visual only -- state untouched
      hops.push({ sgIndex, arm });
      continue;
    }

    const { up } = applyT(theta, phi, state);
    const arm = Math.random() < cAbs2(up) ? 'up' : 'down';
    hops.push({ sgIndex, arm });

    const dest = sg[arm];
    if (dest === null) {
      state = arm === 'up' ? upEigenstate(theta, phi) : downEigenstate(theta, phi);
      continue;
    }
    return { hops, terminal: { sgIndex, arm, dest } };
  }

  return { hops, terminal: null }; // ran off the end of the chain, unmeasured
}

function getUsedColorIds(experiment) {
  const used = new Set();
  experiment.forEach((sg) => {
    ['up', 'down'].forEach((arm) => {
      if (sg[arm]?.type === 'pc') used.add(sg[arm].colorId);
    });
  });
  return used;
}

function getNextColorId(experiment) {
  const used = getUsedColorIds(experiment);
  for (let i = 0; i < PC_COLORS.length; i++) {
    if (!used.has(i)) return i;
  }
  return null; // more PCs placed at once than the palette has colors
}

// Dimensions of an already-placed component -- 'bb' is stored as a bare
// string, a placed particle counter as { type: 'pc', ... }.
function getComponentDims(component) {
  return component === 'bb' ? { width: BB_WIDTH, height: BB_HEIGHT } : { width: PC_WIDTH, height: PC_HEIGHT };
}

// Dimensions of whatever build mode is currently about to place.
function getNewComponentDims(buildMode) {
  return buildMode === 1 ? { width: PC_WIDTH, height: PC_HEIGHT } : { width: BB_WIDTH, height: BB_HEIGHT };
}

// Mouse behavior handlers for placing new components
// The anchor point (input edge, matching where drawImage's local origin sits)
// and rotation angle for a given SG's up/down output site.
function getPlacementSite(sgIndex, arm, axis) {
  const x0 = SG_START_X + sgIndex * SG_SPACING;
  const pcX0 = x0 + SG_WIDTH + OUT_PATH_ARC_RADIUS * Math.sin(OUT_PATH_ARC_ANGLE);

  if (arm === 'up') {
    return {
      x: pcX0,
      y: axis - SG_HEIGHT / 2 + SG_OUTPUT_UP - OUT_PATH_ARC_RADIUS * (1 - Math.cos(OUT_PATH_ARC_ANGLE)),
      angle: -OUT_PATH_ARC_ANGLE,
    };
  }
  return {
    x: pcX0,
    y: axis - SG_HEIGHT / 2 + SG_OUTPUT_DOWN + OUT_PATH_ARC_RADIUS * (1 - Math.cos(OUT_PATH_ARC_ANGLE)),
    angle: OUT_PATH_ARC_ANGLE,
  };
}

// The site's anchor is the image's left-center edge, pre-rotation — not
// where a user would aim visually. Rotate the image's true local center
// (width/2, 0) by the site's angle to get the point to snap-test against.
function getPlacementSiteCenter(site, width) {
  return {
    x: site.x + (width / 2) * Math.cos(site.angle),
    y: site.y + (width / 2) * Math.sin(site.angle),
  };
}

function getSGX0(sgIndex) {
  return SG_START_X + sgIndex * SG_SPACING;
}

function getSGCenter(sgIndex, axis) {
  return { x: getSGX0(sgIndex) + SG_WIDTH / 2, y: axis };
}

// --- Particle path geometry ------------------------------------------------
// The single source of truth for both the "preview possible paths" dashed
// overlay and actual particle animation -- both an "out" arc (to a PC/BB)
// and an "in" arc (back to the next SG's input) for a given arm.
function getArmArc(sgIndex, arm, axis, kind /* 'in' | 'out' */) {
  const cx = getSGX0(sgIndex) + SG_WIDTH;
  const outputY = axis - SG_HEIGHT / 2 + (arm === 'up' ? SG_OUTPUT_UP : SG_OUTPUT_DOWN);

  if (kind === 'out') {
    return arm === 'up'
      ? { cx, cy: outputY - OUT_PATH_ARC_RADIUS, r: OUT_PATH_ARC_RADIUS, startAngle: Math.PI / 2, endAngle: Math.PI / 2 - OUT_PATH_ARC_ANGLE, ccw: true }
      : { cx, cy: outputY + OUT_PATH_ARC_RADIUS, r: OUT_PATH_ARC_RADIUS, startAngle: -Math.PI / 2, endAngle: -Math.PI / 2 + OUT_PATH_ARC_ANGLE, ccw: false };
  }
  return arm === 'up'
    ? { cx, cy: outputY + IN_PATH_ARC_RADIUS, r: IN_PATH_ARC_RADIUS, startAngle: -Math.PI / 2, endAngle: -Math.PI / 2 + IN_PATH_ARC_ANGLE, ccw: false }
    : { cx, cy: outputY - IN_PATH_ARC_RADIUS, r: IN_PATH_ARC_RADIUS, startAngle: Math.PI / 2, endAngle: Math.PI / 2 - IN_PATH_ARC_ANGLE, ccw: true };
}

// Dashed "possible paths" preview: the oven → first SG run, then one arc per
// arm for every SG a particle could still reach (stops at the first SG
// where both arms are occupied, since nothing gets past that one). Takes
// the experiment to draw as a param, not a closed-over one, specifically so
// drawScene can call this twice -- once for the real experiment, once for
// a hypothetical one -- to preview the effect of a pending placement or
// removal before it's actually committed.
function drawPreviewArcs(ctx, exp, axis, color) {
  ctx.strokeStyle = color;
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(OVEN_X0 + OVEN_WIDTH, axis);
  ctx.lineTo(SG_START_X, axis);
  ctx.stroke();

  let incomingParticles = true;
  exp.forEach((sg, i) => {
    if (incomingParticles) {
      ['up', 'down'].forEach((arm) => {
        let continues = sg[arm] === null;
        if (continues && i === exp.length - 1) continues = false; // nothing to continue into
        const a = getArmArc(i, arm, axis, continues ? 'in' : 'out');
        ctx.beginPath();
        ctx.arc(a.cx, a.cy, a.r, a.startAngle, a.endAngle, a.ccw);
        ctx.stroke();
      });
    }
    if (sg['up'] !== null && sg['down'] !== null) {
      incomingParticles = false;
    }
  });

  ctx.setLineDash([]);
}

function segmentLength(seg) {
  if (seg.type === 'line') return Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
  if (seg.type === 'arc') return seg.r * Math.abs(seg.endAngle - seg.startAngle);
  return 0; // 'wait' segments are timed, not distance-based
}

function pointOnSegment(seg, t) {
  if (seg.type === 'wait') return { x: seg.x, y: seg.y };
  if (seg.type === 'line') return { x: seg.x0 + (seg.x1 - seg.x0) * t, y: seg.y0 + (seg.y1 - seg.y0) * t };
  const angle = seg.startAngle + (seg.endAngle - seg.startAngle) * t;
  return { x: seg.cx + seg.r * Math.cos(angle), y: seg.cy + seg.r * Math.sin(angle) };
}

// Builds the full list of animation segments for one sampled particle.
// The transverse offset is applied as a per-segment radius/y delta with a
// single consistent sign; for the "small-ish" widths this is meant for,
// any sub-pixel kink at segment joins should be imperceptible -- if visible
// kinks show up once this is running, that's the spot to revisit.
function buildAnimationPath(experiment, axis, sampled) {
  const { hops, terminal } = sampled;
  const offset = (Math.random() - 0.5) * BEAM_TRANSVERSE_WIDTH;
  const segments = [];

  const sg0InputY = axis - SG_HEIGHT / 2 + SG_INPUT_Y;
  segments.push({ type: 'line', x0: PARTICLE_START_X, y0: sg0InputY + offset, x1: getSGX0(0), y1: sg0InputY + offset });

  hops.forEach(({ sgIndex, arm }) => {
    const inputY = axis - SG_HEIGHT / 2 + SG_INPUT_Y;
    segments.push({ type: 'wait', x: getSGX0(sgIndex), y: inputY + offset, ms: SG_PROCESSING_MS });

    const isTerminalHop = terminal && terminal.sgIndex === sgIndex && terminal.arm === arm;
    const arc = getArmArc(sgIndex, arm, axis, isTerminalHop ? 'out' : 'in');
    segments.push({ ...arc, r: arc.r + offset, type: 'arc' });
  });

  if (!terminal) {
    const last = segments[segments.length - 1];
    const p1 = pointOnSegment(last, 0.98);
    const p2 = pointOnSegment(last, 1.0);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    segments.push({
      type: 'line', x0: p2.x, y0: p2.y,
      x1: p2.x + (dx / len) * ESCAPE_RUN_LENGTH, y1: p2.y + (dy / len) * ESCAPE_RUN_LENGTH,
    });
  }

  return { segments, terminal };
}

// Every site the currently-selected build-mode component could legally go --
// empty arms, plus occupied arms it's allowed to replace (anything can
// replace a BB; only a BB may replace a PC, since silently overwriting a PC
// would also silently discard its collected counts). Each candidate's
// center/radius are sized to whatever's already there, or to the new
// component's own size if the site is empty -- shared by the nearest-site
// snap logic below and by drawScene's site-circle highlight, so the two
// always agree with each other.
function getPlacementCandidates(experiment, axis, buildMode) {
  const newDims = getNewComponentDims(buildMode);
  const candidates = [];

  experiment.forEach((sg, sgIndex) => {
    ['up', 'down'].forEach((arm) => {
      const existing = sg[arm];
      if (existing !== null) {
        if (existing.type === 'pc' && buildMode === 1) return;
        if (existing === 'bb' && buildMode === 2) return;
      }

      const dims = existing === null ? newDims : getComponentDims(existing);
      const site = getPlacementSite(sgIndex, arm, axis);
      const center = getPlacementSiteCenter(site, dims.width);
      const radius = (Math.max(dims.width, dims.height) / 2) * SITE_MARGIN;

      candidates.push({ sgIndex, arm, site, center, radius });
    });
  });

  return candidates;
}

// Nearest candidate site within its own circle -- each site's snap radius
// is exactly the radius of the circle drawn there (see getPlacementCandidates),
// so a big existing component is easier to hit than an empty site would be.
function findNearestPlacementSite(mouseX, mouseY, experiment, axis, buildMode) {
  let closest = null;
  let closestDist = Infinity;

  getPlacementCandidates(experiment, axis, buildMode).forEach((candidate) => {
    const dist = Math.hypot(mouseX - candidate.center.x, mouseY - candidate.center.y);
    if (dist < candidate.radius && dist < closestDist) {
      closestDist = dist;
      closest = candidate;
    }
  });

  return closest;
}

// Deletion only — SG bodies and occupied arm components are both circular
// candidates now, compared on equal footing; whichever is nearest wins.
function findNearestDeletable(mouseX, mouseY, experiment, axis) {
  let closest = null;
  let closestDist = Infinity;

  experiment.forEach((sg, sgIndex) => {
    // The SG apparatus body itself
    const sgCenter = getSGCenter(sgIndex, axis);
    const sgRadius = (Math.max(SG_WIDTH, SG_HEIGHT) / 2) * SITE_MARGIN;
    const sgDist = Math.hypot(mouseX - sgCenter.x, mouseY - sgCenter.y);

    if (sgDist < sgRadius && sgDist < closestDist) {
      closestDist = sgDist;
      closest = { kind: 'sg', sgIndex, center: sgCenter, radius: sgRadius };
    }

    // Its arm components, if present
    ['up', 'down'].forEach((arm) => {
      if (sg[arm] === null) return;

      const width = sg[arm].type === 'pc' ? PC_WIDTH : BB_WIDTH;
      const height = sg[arm].type === 'pc' ? PC_HEIGHT : BB_HEIGHT;
      const site = getPlacementSite(sgIndex, arm, axis);
      const center = getPlacementSiteCenter(site, width);
      const radius = (Math.max(width, height) / 2) * SITE_MARGIN;
      const dist = Math.hypot(mouseX - center.x, mouseY - center.y);

      if (dist < radius && dist < closestDist) {
        closestDist = dist;
        closest = { kind: 'arm', sgIndex, arm, site, width, height, center, radius };
      }
    });
  });

  return closest;
}

// While build/delete mode is hovering a valid snap target, this is what
// `experiment` would look like immediately after committing that action --
// used so the path preview can show the *resulting* paths, not just the
// current ones, before the user actually clicks. Only single-arm changes
// (placing or removing a PC/BB) get a preview this way: deleting a whole SG
// changes the chain's length and shifts every later SG's position, so
// there's no well-defined overlay for it against the still-unchanged, still
// full-length real experiment -- that case keeps only the existing
// cascade-highlight (see the delete-mode block in drawScene) with no path
// preview.
function getPreviewExperiment(experiment, expMode, mousePos, axis) {
  if (!mousePos) return null;

  if (expMode.build === 1 || expMode.build === 2) {
    const snapped = findNearestPlacementSite(mousePos.x, mousePos.y, experiment, axis, expMode.build);
    if (!snapped) return null;
    const next = [...experiment];
    const placed = expMode.build === 1 ? { type: 'pc', data: 0, colorId: null } : 'bb';
    next[snapped.sgIndex] = { ...next[snapped.sgIndex], [snapped.arm]: placed };
    return next;
  }

  if (expMode.build === -1) {
    const target = findNearestDeletable(mousePos.x, mousePos.y, experiment, axis);
    if (!target || target.kind !== 'arm') return null;
    const next = [...experiment];
    next[target.sgIndex] = { ...next[target.sgIndex], [target.arm]: null };
    return next;
  }

  return null;
}

// --- Start-validation warning -----------------------------------------
// Wraps `text` into lines no wider than ERROR_TEXT_MAX_WIDTH (in the
// context's current font), breaking on whitespace -- keeps the on-canvas
// error explanation from running far off to the side of the panel.
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);

  return lines;
}

// Draws `text`, left-justified and word-wrapped to ERROR_TEXT_MAX_WIDTH, as
// a block vertically centered on yCenter -- so a warning's text always
// reads as "pointing at" the same height regardless of how many lines it
// wraps to. Caller is expected to have already set ctx.fillStyle.
function drawWrappedText(ctx, text, x, yCenter) {
  ctx.font = '18px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const lines = wrapText(ctx, text, ERROR_TEXT_MAX_WIDTH);
  const startY = yCenter - ((lines.length - 1) * ERROR_TEXT_LINE_HEIGHT) / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, startY + i * ERROR_TEXT_LINE_HEIGHT));
}

// Renders one bar meter: a card the same size as the PC image, the "SGn↑/↓"
// identifier in the same spot the normal PC label uses, an empty meter
// outline, and a fill scaled to `prob` (already the exact, renormalized
// theoretical probability for this one detector -- see theoryMap in
// drawScene, built the same way Histogram.jsx builds its own so the two
// never disagree) plus a percentage readout below it. Called from inside
// the same translate/rotate frame the PC image itself draws in.
// drawMode = 1 means draw the theory bar and percent label; = 2 means draw a big ?
function drawTheoryBar(ctx, pc, sgIndex, arm, prob, drawMode) {
  const color = pc.colorId !== null ? PC_COLORS[pc.colorId] : '#999999';

  // Border around whole card
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#303030';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT*THEORY_BAR_CARD_MULTIPLIER, 6);
  ctx.fill();
  ctx.stroke();

  if (drawMode === 1) {
    // Theory label at top
    ctx.fillStyle = color;
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelText = `${(prob * 100).toFixed(1)}%`;
    const labelTextWidth = ctx.measureText(labelText).width;
    const labelX0 = PC_ALT_TEXT_CENTER_X;
    ctx.fillText(labelText, labelX0, PC_LABEL_CENTER_Y+6);

    // Theory bar
    ctx.strokeStyle = '#303030';
    ctx.lineWidth = 1;
    ctx.strokeRect(THEORY_BAR_X0, THEORY_BAR_Y0, THEORY_BAR_WIDTH, THEORY_BAR_HEIGHT);
    ctx.fillStyle = color;
    ctx.fillRect(THEORY_BAR_X0, THEORY_BAR_Y0, THEORY_BAR_WIDTH * prob, THEORY_BAR_HEIGHT);
  } else if (drawMode === 2) {
    // ? label
    ctx.fillStyle = color;
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', PC_WIDTH/2, PC_HEIGHT*(THEORY_BAR_CARD_MULTIPLIER-1)/1.2);
  }
}

const LabPanel = forwardRef(function LabPanel(
  { experiment, setExperiment, expMode, setExpMode, displayBools, setParticleCount, resetToken, resetDataCollection, tabVisible, startError, hoveredDetector },
  ref
) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [axis, setAxis] = useState(300); // y-coordinate of halfway down the canvas; determines position of all user-created devices
  // These refs hold the SG and PC images for all time, using the loading hook
  const [ovenImageRef, ovenImageLoaded] = useImage(ovenImage);
  const [ovenOffImageRef, ovenOffImageLoaded] = useImage(ovenOffImage);
  const [sgImageRef, sgImageLoaded] = useImage(sgImage);
  const [pcImageRef, pcImageLoaded] = useImage(pcImage);
  const [bbImageRef, bbImageLoaded] = useImage(bbImage);
  // This holds positions for a preview image or for checking component deletion ranges, as needed
  const [mousePos, setMousePos] = useState(null); // null = no preview to show right now and not in deletion mode
  // Live, per-frame-mutated particle list -- deliberately a ref, not state,
  // so 60fps position updates don't re-render the whole app. particleCount
  // (a prop, real state owned by App) is the only piece of this that the
  // rest of the UI needs to react to.
  const particlesRef = useRef([]);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(null);

  // Resize canvas to fill container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;

      // The canvas's pixel buffer (.width/.height) is a separate thing from
      // its on-screen CSS size -- setting both to the same CSS-pixel number
      // means the buffer only has as many pixels as a 1x display needs, so
      // on any HiDPI/Retina screen the browser stretches that undersized
      // buffer to fill the real pixel grid, blurring everything drawn on
      // it. Give the buffer devicePixelRatio-many actual pixels per CSS
      // pixel, pin the CSS size back down to the original (unscaled) size,
      // and scale the context so all the existing drawing code -- which is
      // written entirely in CSS-pixel coordinates -- needs no changes.
      const dpr = window.devicePixelRatio || 1;
      canvas.width = newWidth * dpr;
      canvas.height = newHeight * dpr;
      canvas.style.width = `${newWidth}px`;
      canvas.style.height = `${newHeight}px`;
      const resizedCtx = canvas.getContext('2d');
      resizedCtx.scale(dpr, dpr);
      resizedCtx.imageSmoothingQuality = 'high'; // the oven in particular is a large downscale (992x654 source)

      setCanvasDims({ width: newWidth, height: newHeight });

      const halfwayY = newHeight / 2;
      setAxis(halfwayY);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // Draws everything except in-flight particles: grid, SGs, path previews,
  // PCs/BBs, and placement/deletion highlights. Called either from the
  // state-driven effect below (when idle) or every frame from the particle
  // animation loop (while particles exist), so there's one definition of
  // "what the static scene looks like" regardless of who's asking.
  const drawScene = useCallback((ctx) => {
    // canvas.width/height are now the devicePixelRatio-scaled backing-store
    // size, not the CSS/logical size everything else here is drawn in --
    // canvasDims (kept in step with the unscaled container size) is the
    // one to use for bounds.
    const { width, height } = canvasDims;

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = displayBools.gridOn ? '#e0e0e0' : '#ffffff';
    ctx.lineWidth = 1;
    for (let i = 0; i <= width; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, height);
      ctx.stroke();
    }
    for (let i = 0; i <= height; i += 50) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(width, i);
      ctx.stroke();
    }

    if ((expMode.running || particlesRef.current.length > 0) && ovenImageRef.current && ovenImageRef.current.complete) {
      ctx.drawImage(ovenImageRef.current, OVEN_X0, axis - OVEN_HEIGHT / 2, OVEN_WIDTH, OVEN_HEIGHT);
    } else if (!expMode.running && ovenOffImageRef.current && ovenOffImageRef.current.complete) {
      ctx.drawImage(ovenOffImageRef.current, OVEN_X0, axis - OVEN_HEIGHT / 2, OVEN_WIDTH, OVEN_HEIGHT);
    }

    // Build mode's snap target, computed once up front so both the SG loop
    // below (which needs to skip drawing whatever's really occupying the
    // snapped site) and the site-circle overlay after it agree on the same
    // site.
    const buildSnappedSite = (expMode.build === 1 || expMode.build === 2) && mousePos
      ? findNearestPlacementSite(mousePos.x, mousePos.y, experiment, axis, expMode.build)
      : null;

    // Whichever image the three build-mode overlay blocks below actually
    // draw -- pc in PC mode, bb in BB mode -- so each can check readiness
    // of the one it needs instead of always checking pcImageRef regardless
    // of mode (the bug: in BB mode that let a not-yet-loaded bbImageRef
    // through and crashed on drawImage).
    const activeComponentImageRef = expMode.build === 1 ? pcImageRef : bbImageRef;

    // theoryScreenshotToggle (Shift+P): exact theoretical hit probability
    // per placed PC, renormalized to sum to 1 across just the placed PCs --
    // built the same way Histogram.jsx builds its own theory overlay, so
    // the percentage shown here on the apparatus always matches the one the
    // histogram would show.
    const theoryMap = displayBools.theoryScreenshotToggle
      ? (() => {
          const theoryList = theoreticalProbabilities(experiment);
          const theorySum = theoryList.reduce((s, t) => s + t.prob, 0);
          return new Map(theoryList.map((t) => [`${t.sgIndex}-${t.arm}`, theorySum > 0 ? t.prob / theorySum : 0]));
        })()
      : null;

    // Draw the SGs, one copy of the ref image each, plus the basis labels
    if (imageReady(sgImageRef) && imageReady(pcImageRef) && imageReady(bbImageRef)) {
      if (displayBools.previewPaths) {
        // While hovering a valid placement/removal target, show the *old*
        // path (still real until the click actually lands) in light gray
        // underneath the *resulting* path in the normal preview color, so
        // the effect of the pending change is visible before committing to
        // it. Off target (or not in build/delete mode at all), there's
        // nothing to contrast against, so just the one normal-color path.
        const previewExperiment = getPreviewExperiment(experiment, expMode, mousePos, axis);
        if (previewExperiment) {
          drawPreviewArcs(ctx, experiment, axis, '#cccccc');
          drawPreviewArcs(ctx, previewExperiment, axis, '#303030');
        } else {
          drawPreviewArcs(ctx, experiment, axis, '#303030');
        }
      }

      experiment.forEach((sg, i) => {
        const x0 = SG_START_X + i * SG_SPACING;

        // Draw the SGs
        ctx.drawImage(sgImageRef.current, x0, axis - SG_HEIGHT / 2, SG_WIDTH, SG_HEIGHT);

        // Draw the basis label
        ctx.fillStyle = '#303030';
        ctx.font = '32px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(getSGLabel(sg.basis, i), x0+62, axis);

        // Draw whatever's really placed on each arm -- except the site
        // currently snapped to in build mode, whose occupant (if any) is
        // about to be replaced, so the new component is drawn there instead
        // by the overlay below.
        ['up', 'down'].forEach((arm) => {
          if (sg[arm] === null) return;
          if (buildSnappedSite && buildSnappedSite.sgIndex === i && buildSnappedSite.arm === arm) return;

          const site = getPlacementSite(i, arm, axis);
          ctx.save();
          ctx.translate(site.x, site.y);
          ctx.rotate(site.angle);
          if (sg[arm].type === 'pc') {
            if (displayBools.theoryScreenshotToggle !== 0) {
              const prob = theoryMap.get(`${i}-${arm}`) ?? 0;
              drawTheoryBar(ctx, sg[arm], i, arm, prob, displayBools.theoryScreenshotToggle);
            } else {
              ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT);
              if (sg[arm].colorId !== null) {
                ctx.save();
                ctx.globalAlpha = PC_STRIPE_ALPHA;
                ctx.fillStyle = PC_COLORS[sg[arm].colorId];
                ctx.fillRect(PC_STRIPE_CENTER_X - PC_STRIPE_WIDTH / 2, -PC_HEIGHT / 2, PC_STRIPE_WIDTH, PC_HEIGHT);
                ctx.restore();
              }
              // Same "SG1<arrow>" wording the histogram puts under each bar,
              // so the detector reads identically in both places without the
              // student having to match colors through the legend. The arrow
              // itself is a filled path (drawArrow), not a Unicode glyph --
              // see canvasArrow.js for why.
              ctx.fillStyle = '#666';
              ctx.font = 'bold 12px Arial';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              const pcLabelText = `SG${i + 1}`;
              const pcArrowSize = 11;
              const pcArrowGap = 3;
              const pcLabelTextWidth = ctx.measureText(pcLabelText).width;
              const pcLabelWidth = pcLabelTextWidth + pcArrowGap + arrowWidth(pcArrowSize);
              const pcLabelX0 = PC_TEXT_CENTER_X - pcLabelWidth / 2;
              ctx.fillText(pcLabelText, pcLabelX0, PC_LABEL_CENTER_Y);
              drawArrow(
                ctx,
                pcLabelX0 + pcLabelTextWidth + pcArrowGap + arrowWidth(pcArrowSize) / 2,
                PC_LABEL_CENTER_Y,
                pcArrowSize,
                arm === 'up' ? 'up' : 'down'
              );
              // Data text
              if (sg[arm].data !== null) {
                ctx.fillStyle = sg[arm].colorId !== null ? PC_COLORS[sg[arm].colorId] : '#303030';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(sg[arm].data, PC_TEXT_CENTER_X, PC_COUNT_CENTER_Y);
              }
            }
            if (hoveredDetector && hoveredDetector.sgIndex === i && hoveredDetector.arm === arm && sg[arm].colorId !== null) {
              ctx.strokeStyle = PC_COLORS[sg[arm].colorId];
              ctx.lineWidth = PC_HIGHLIGHT_LINE_WIDTH;
              ctx.strokeRect(
                -PC_HIGHLIGHT_PADDING,
                -PC_HEIGHT / 2 - PC_HIGHLIGHT_PADDING,
                PC_WIDTH + PC_HIGHLIGHT_PADDING * 2,
                PC_HEIGHT + PC_HIGHLIGHT_PADDING * 2
              );
            }
          } else {
            ctx.drawImage(bbImageRef.current, 0, -BB_HEIGHT / 2, BB_WIDTH, BB_HEIGHT);
          }
          ctx.restore();
        });
      });
    }

    // Build mode: highlight every site the new component could legally go --
    // one circle per site, sized to whatever's already there (or to the new
    // component itself, if the site is empty) -- plus a half-opacity preview
    // of the new component at sites that don't have anything on them yet.
    // Drawn unconditionally whenever build mode is active, not just once the
    // cursor happens to be over the canvas, so the sites are visible the
    // instant build mode is entered. Left in place for every site except the
    // one currently snapped to below, which gets its own green circle and
    // full-opacity component instead -- drawing both there would double up.
    if (expMode.build > 0 && imageReady(activeComponentImageRef)) {
      getPlacementCandidates(experiment, axis, expMode.build).forEach((candidate) => {
        if (buildSnappedSite && candidate.sgIndex === buildSnappedSite.sgIndex && candidate.arm === buildSnappedSite.arm) return;
        ctx.strokeStyle = '#f39c12';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(candidate.center.x, candidate.center.y, candidate.radius, 0, Math.PI * 2);
        ctx.stroke();

        if (experiment[candidate.sgIndex][candidate.arm] === null) {
          ctx.save();
          ctx.translate(candidate.site.x, candidate.site.y);
          ctx.rotate(candidate.site.angle);
          ctx.globalAlpha = 0.5;
          expMode.build === 1
            ? ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT)
            : ctx.drawImage(bbImageRef.current, 0, -BB_HEIGHT / 2, BB_WIDTH, BB_HEIGHT);
          ctx.globalAlpha = 1.0;
          ctx.restore();
        }
      });
    }
    // Build mode: cursor has snapped to a site -- on top of the candidate
    // circles/previews above, show a green circle (always sized to the new
    // component, not whatever it's replacing) around that one site, and
    // draw the new component there at full opacity, standing in for
    // whatever's really occupying it (skipped above, in the SG loop).
    if (expMode.build > 0 && buildSnappedSite && imageReady(activeComponentImageRef)) {
      const newDims = getNewComponentDims(expMode.build);
      const center = getPlacementSiteCenter(buildSnappedSite.site, newDims.width);

      ctx.beginPath();
      ctx.arc(center.x, center.y, (Math.max(newDims.width, newDims.height) / 2) * SITE_MARGIN, 0, Math.PI * 2);
      ctx.strokeStyle = '#2ecc71';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.save();
      ctx.translate(buildSnappedSite.site.x, buildSnappedSite.site.y);
      ctx.rotate(buildSnappedSite.site.angle);
      expMode.build === 1 ? ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT) : ctx.drawImage(bbImageRef.current, 0, -BB_HEIGHT / 2, BB_WIDTH, BB_HEIGHT);
      ctx.restore();
    }
    // Build mode: not snapped anywhere -- follow the cursor with a
    // half-opacity, unrotated preview of the new component, same as the
    // pre-replacement UI's drag-along ghost. Once the cursor snaps to a
    // site (block above), this stops -- the docked full-opacity component
    // there is the only preview shown.
    if (expMode.build > 0 && mousePos && !buildSnappedSite && imageReady(activeComponentImageRef)) {
      ctx.globalAlpha = 0.5;
      expMode.build === 1
        ? ctx.drawImage(pcImageRef.current, mousePos.x - PC_WIDTH / 2, mousePos.y - PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT)
        : ctx.drawImage(bbImageRef.current, mousePos.x - BB_WIDTH / 2, mousePos.y - BB_HEIGHT / 2, BB_WIDTH, BB_HEIGHT);
      ctx.globalAlpha = 1.0;
    }

    // Hovering over an existing component in delete mode
    if (expMode.build === -1 && mousePos) {
      const target = findNearestDeletable(mousePos.x, mousePos.y, experiment, axis);
      if (target) {
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.arc(target.center.x, target.center.y, target.radius, 0, Math.PI * 2);
        ctx.stroke();

        if (target.kind === 'sg') {
          // Preview the cascade: circle anything on this SG's arms too
          const sg = experiment[target.sgIndex];
          ['up', 'down'].forEach((arm) => {
            if (sg[arm] === null) return;
            const width = sg[arm].type === 'pc' ? PC_WIDTH : BB_WIDTH;
            const height = sg[arm].type === 'pc' ? PC_HEIGHT : BB_HEIGHT;
            const site = getPlacementSite(target.sgIndex, arm, axis);
            const armCenter = getPlacementSiteCenter(site, width);
            ctx.beginPath();
            ctx.arc(armCenter.x, armCenter.y, (Math.max(width, height) / 2) * SITE_MARGIN, 0, Math.PI * 2);
            ctx.stroke();
          });
        }
      }
    }
    
    // Start-validation warning: bright red circle(s) around whatever's
    // missing -- the not-yet-existing first SG, or each open arm on the
    // last one -- with its own left-justified, word-wrapped explanation
    // vertically centered on that circle (not on `axis` -- an open "up" and
    // open "down" arm each get their own message at their own height, not
    // one message shared between the two). Only ever set by App in
    // response to an actual Make One Particle/Start press (see the
    // startError prop), and only ever cleared or narrowed by App from
    // there -- never re-derived from scratch -- so fixing one problem can't
    // eagerly reveal a different one; see recheckStartError. Drawn last so
    // it always sits on top of any build-mode overlay underneath.
    if (startError) {
      const sites = startError.kind === 'noSG'
        ? [{
            center: getSGCenter(0, axis),
            radius: (Math.max(SG_WIDTH, SG_HEIGHT) / 2) * SITE_MARGIN,
            message: 'Add a Stern-Gerlach apparatus before starting.',
          }]
        : startError.openArms.map((arm) => {
            const site = getPlacementSite(startError.sgIndex, arm, axis);
            const center = getPlacementSiteCenter(site, PC_WIDTH);
            return {
              center,
              radius: (Math.max(PC_WIDTH, PC_HEIGHT) / 2) * SITE_MARGIN,
              message: `The ${arm} path is unterminated -- add a particle counter or beam block here before starting.`,
            };
          });

      ctx.strokeStyle = '#ff0000';
      ctx.fillStyle = '#ff0000';
      ctx.lineWidth = 3;
      sites.forEach(({ center, radius, message }) => {
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        drawWrappedText(ctx, message, center.x + radius + ERROR_TEXT_GAP, center.y);
      });
    }
  }, [experiment, expMode, displayBools, mousePos, axis, canvasDims, startError, hoveredDetector, bbImageRef, pcImageRef, ovenImageRef, ovenOffImageRef, sgImageRef]);

  const drawParticles = useCallback((ctx) => {
    ctx.fillStyle = PARTICLE_COLOR;
    particlesRef.current.forEach((p) => {
      const seg = p.segments[p.segmentIndex];
      // 'wait' = "inside" the SG -- hidden rather than frozen at the input,
      // so it reads as continuing through rather than pausing at the door.
      if (!seg || seg.type === 'wait') return;
      const dur = (segmentLength(seg) / PARTICLE_SPEED) * 1000;
      const t = dur > 0 ? Math.min(p.segmentElapsed / dur, 1) : 1;
      const pos = pointOnSegment(seg, t);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, PARTICLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  // tickRef's job is to hold THE single source of truth for what the next
  // frame should look like. If you tried running this as a regular variable,
  // you might end up scheduling re-renders on top of each other, which is 
  // hard to fix. tickRef always points at a fresh closure over the current
  // experiment/setExperiment/drawScene/etc. -- refreshed after every render
  // (cheap: just a closure allocation, no timers or DOM work) -- so the
  // recursive rAF loop below is never stuck reading stale props no matter
  // how long it's been running.
  const tickRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
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
          const dur = seg.type === 'wait' ? seg.ms : (segmentLength(seg) / PARTICLE_SPEED) * 1000;
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
        const pcHits = finished.filter((p) => p.terminal && p.terminal.dest.type === 'pc');
        if (pcHits.length > 0) {
          setExperiment((prev) => {
            const next = [...prev];
            pcHits.forEach((p) => {
              const { sgIndex, arm } = p.terminal;
              next[sgIndex] = { ...next[sgIndex], [arm]: { ...next[sgIndex][arm], data: next[sgIndex][arm].data + 1 } };
            });
            return next;
          });
        }
        particlesRef.current = particlesRef.current.filter((p) => !finished.includes(p));
        setParticleCount(particlesRef.current.length);
      }

      drawScene(ctx);
      drawParticles(ctx);

      // Make sure to call this function again after you execute it!
      // This is what keeps the loop going
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

  // Pause the animation loop while the tab is hidden, in lockstep with App
  // pausing particle production (see its tabVisible effect) -- otherwise
  // the two drift out of sync based on whatever throttling the browser
  // happens to apply to timers vs. rAF callbacks in background tabs. In-
  // flight particles are left as they are (not cleared), so this is a true
  // pause: resuming resets lastFrameRef to null so the next tick computes
  // dt from zero, rather than treating the whole hidden interval as one
  // giant elapsed frame and fast-forwarding every particle to its end.
  useEffect(() => {
    if (!tabVisible) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    } else if (particlesRef.current.length > 0 && rafRef.current === null) {
      lastFrameRef.current = null;
      rafRef.current = requestAnimationFrame((now) => tickRef.current(now));
    }
  }, [tabVisible]);

  const spawnParticle = () => {
    if (experiment.length === 0) return; // nothing to simulate
    const sampled = samplePath(experiment);
    const path = buildAnimationPath(experiment, axis, sampled);
    particlesRef.current = [...particlesRef.current, { ...path, segmentIndex: 0, segmentElapsed: 0 }];
    setParticleCount(particlesRef.current.length);
    // The loop only advances itself while already running (see tickRef
    // above) -- if this is the first particle, nothing else will ever
    // notice it exists, so explicitly wake the loop up here.
    if (rafRef.current === null) {
      lastFrameRef.current = null;
      rafRef.current = requestAnimationFrame((now) => tickRef.current(now));
    }
  };

  useImperativeHandle(ref, () => ({ spawnParticle }));

  // Reset: clears every in-flight particle whenever App bumps resetToken
  useEffect(() => {
    particlesRef.current = [];
    setParticleCount(0);
  }, [resetToken, setParticleCount]);

  // Drawing (idle state) -- the particle loop above owns drawing while any
  // particles are in flight, so this just draws the static scene once per
  // relevant state change the rest of the time.
  useEffect(() => {
    if (particlesRef.current.length > 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawScene(canvas.getContext('2d'));
  }, [experiment, expMode, ovenImageLoaded, ovenOffImageLoaded, sgImageLoaded, pcImageLoaded, bbImageLoaded, mousePos, axis, canvasDims, displayBools, startError, drawScene]);

  // Mouse handlers
  const handleClick = (e) => {
    if (particlesRef.current.length > 0) return; // locked while particles are propagating
    if (expMode.build === 0) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (expMode.build === -1) {
      const target = findNearestDeletable(mouseX, mouseY, experiment, axis);
      if (!target) return;

      if (target.kind === 'sg') {
        setExperiment((prev) => prev.filter((_, i) => i !== target.sgIndex));
      } else {
        setExperiment((prev) => {
          const next = [...prev];
          next[target.sgIndex] = { ...next[target.sgIndex], [target.arm]: null };
          return next;
        });
      }
      setExpMode({ ...expMode, build: 0 });
      resetDataCollection(); // deleting a component is a setup change
      return;
    }

    const snapped = findNearestPlacementSite(mouseX, mouseY, experiment, axis, expMode.build);
    if (!snapped) return;

    const { sgIndex, arm } = snapped;
    setExperiment((prev) => {
      const next = [...prev];
      if (expMode.build === 1) {
        const colorId = getNextColorId(prev);
        next[sgIndex] = { ...next[sgIndex], [arm]: { type: 'pc', data: 0, colorId } };
      } else {
        next[sgIndex] = { ...next[sgIndex], [arm]: 'bb' };
      }
      return next;
    });
    setExpMode({ ...expMode, build: 0 });
    resetDataCollection(); // placing a component is a setup change
  };

  const handleMouseMove = (e) => {
    if (particlesRef.current.length > 0 || expMode.build === 0 || expMode.running === true) {
      setMousePos(null);
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseLeave = () => {
    setMousePos(null)
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{
          display: 'block',
          touchAction: 'none',
        }}
      />
    </div>
  );
});

export default LabPanel;
