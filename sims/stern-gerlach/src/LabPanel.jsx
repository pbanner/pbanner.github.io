import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { upEigenstate, downEigenstate, applyT, sampleOvenState, cAbs2 } from './physics';
import { PC_COLORS } from './colors';
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
const PC_INPUT = PC_HEIGHT/2;
const PC_COLOR_DOT_X = 340*(PC_WIDTH/400);
const PC_COLOR_DOT_R = 40*(PC_WIDTH/400);
const PC_TEXT_CENTER_X = 190*(PC_WIDTH/400);
const BB_HEIGHT = 50;
const BB_WIDTH = 9;
const BB_INPUT = BB_HEIGHT/2;
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
// Snap radius for UI
const SNAP_RADIUS = 50;  // px — how close the cursor must be to snap

// Particle animation specs -- all tunable
const PARTICLE_START_X = OVEN_X0 + OVEN_WIDTH;     // x-value where particles first appear
const PARTICLE_SPEED = 300;        // px/sec while visibly moving
const SG_PROCESSING_MS = 200;      // fixed pause while "inside" an SG
const BEAM_TRANSVERSE_WIDTH = 14;  // px, full spread of the (uniform) beam jitter
const PARTICLE_RADIUS = 4;
const PARTICLE_COLOR = '#3498db';  // same blue as .control-bar-button etc.
const ESCAPE_RUN_LENGTH = 1200;    // px of straight travel for a particle that exits the chain unmeasured

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

// For placement and deletion snapping and finding
const DELETE_MARGIN = 1.3; // multiplier on half-the-longest-dimension, for all delete hitboxes/highlights

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

// Placement only — unchanged from before, only considers empty arm sites.
function findNearestPlacementSite(mouseX, mouseY, experiment, axis, width) {
  let closest = null;
  let closestDist = SNAP_RADIUS;

  experiment.forEach((sg, sgIndex) => {
    ['up', 'down'].forEach((arm) => {
      if (sg[arm] !== null) return;

      const site = getPlacementSite(sgIndex, arm, axis);
      const center = getPlacementSiteCenter(site, width);
      const dist = Math.hypot(mouseX - center.x, mouseY - center.y);

      if (dist < closestDist) {
        closestDist = dist;
        closest = { sgIndex, arm, site };
      }
    });
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
    const sgRadius = (Math.max(SG_WIDTH, SG_HEIGHT) / 2) * DELETE_MARGIN;
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
      const radius = (Math.max(width, height) / 2) * DELETE_MARGIN;
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
    const width = expMode.build === 1 ? PC_WIDTH : BB_WIDTH;
    const snapped = findNearestPlacementSite(mousePos.x, mousePos.y, experiment, axis, width);
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

const LabPanel = forwardRef(function LabPanel(
  { experiment, setExperiment, expMode, setExpMode, displayBools, setParticleCount, resetToken, resetDataCollection, tabVisible },
  ref
) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // Used for mouse dragging events
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

    // Draw the SGs, one copy of the ref image each, plus the basis labels
    if (sgImageRef.current && sgImageRef.current.complete) {
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

        // Draw SGs and BBs as needed
        ['up', 'down'].forEach((arm) => {
          // If we're not in a preview mode and there's no component here, don't draw anything
          if (expMode.build < 1 && sg[arm] === null) return;
          // We're drawing SOMETHING
          const site = getPlacementSite(i, arm, axis);
          ctx.save();
          ctx.translate(site.x, site.y);
          ctx.rotate(site.angle);
          if (sg[arm] !== null) {
            if (sg[arm].type === 'pc') {
              ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT);
              if (sg[arm].colorId !== null) {
                ctx.beginPath();
                ctx.arc(PC_COLOR_DOT_X, 0, PC_COLOR_DOT_R, 0, Math.PI * 2);
                ctx.fillStyle = PC_COLORS[sg[arm].colorId];
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
              }
              if (sg[arm].data !== null) {
                ctx.fillStyle = '#303030';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(sg[arm].data, PC_TEXT_CENTER_X, 0);
              }
            } else {
              ctx.drawImage(bbImageRef.current, 0, -BB_HEIGHT / 2, BB_WIDTH, BB_HEIGHT);
            }
          } else {
            // If we've reached this point, we're previewing sites
            ctx.globalAlpha = 0.5;
            expMode.build === 1 ? ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT) : ctx.drawImage(bbImageRef.current, 0, -BB_HEIGHT / 2, BB_WIDTH, BB_HEIGHT);
            ctx.globalAlpha = 1.0;
          }
          ctx.restore();
        });
      });
    }

    // If we're in a placement mode, draw an image of the thing being placed to drag along the cursor
    if (expMode.build > 0 && mousePos && pcImageRef.current && pcImageRef.current.complete) {
      const snapped = findNearestPlacementSite(mousePos.x, mousePos.y, experiment, axis, expMode.build === 1 ? PC_WIDTH : BB_WIDTH);

      if (snapped) {
        const center = getPlacementSiteCenter(snapped.site, expMode.build === 1 ? PC_WIDTH : BB_WIDTH);
        ctx.beginPath();
        ctx.arc(
          center.x, center.y,
          expMode.build === 1 ? Math.max(PC_WIDTH, PC_HEIGHT) / 2 * 1.3 : Math.max(BB_WIDTH, BB_HEIGHT) / 2 * 1.3,
          0, Math.PI * 2);
        ctx.strokeStyle = '#2ecc71';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.save();
        ctx.translate(snapped.site.x, snapped.site.y);
        ctx.rotate(snapped.site.angle);
        expMode.build === 1 ? ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT) : ctx.drawImage(bbImageRef.current, 0, -BB_HEIGHT / 2, BB_WIDTH, BB_HEIGHT);
        ctx.restore();
      } else {
        expMode.build === 1 ? ctx.drawImage(pcImageRef.current, mousePos.x - PC_WIDTH / 2, mousePos.y - PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT) : ctx.drawImage(bbImageRef.current, mousePos.x - BB_WIDTH / 2, mousePos.y - BB_HEIGHT / 2, BB_WIDTH, BB_HEIGHT);
      }
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
            ctx.arc(armCenter.x, armCenter.y, (Math.max(width, height) / 2) * DELETE_MARGIN, 0, Math.PI * 2);
            ctx.stroke();
          });
        }
      }
    }
  }, [experiment, expMode, displayBools, mousePos, axis, canvasDims]);

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

  // `experimentOverride` lets a caller that just synchronously updated
  // `experiment` (e.g. auto-inserting a beam block right before starting)
  // spawn against the fresh value immediately, since setExperiment is
  // async and this component's own `experiment` prop won't reflect it
  // until the next render.
  const spawnParticle = (experimentOverride) => {
    const exp = experimentOverride ?? experiment;
    if (exp.length === 0) return; // nothing to simulate
    const sampled = samplePath(exp);
    const path = buildAnimationPath(exp, axis, sampled);
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
  }, [experiment, expMode, ovenImageLoaded, ovenOffImageLoaded, sgImageLoaded, pcImageLoaded, mousePos, axis, canvasDims, displayBools, drawScene]);

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
      resetDataCollection(); // deleting a component is a setup change
      return;
    }

    const snapped = findNearestPlacementSite(mouseX, mouseY, experiment, axis, expMode.build === 1 ? PC_WIDTH : BB_WIDTH);
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
