import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { samplePairOutcome } from './physics';
import { PC_COLORS } from './colors';
import { drawArrow } from './canvasArrow';
import sgImage from './assets/sg/SG.png';
import pcImage from './assets/sg/PC.png';
import ovenImage from './assets/sg/oven.png';
import ovenOffImage from './assets/sg/ovenOff.png';

// --- Geometry --------------------------------------------------------------
// Every constant and formula below is lifted directly from the Stern-Gerlach
// sim's LabPanel.jsx -- same oven/SG/detector sizes, same input/output pixel
// offsets read off the SG image, same output-arc radius and angle. What's
// different here is *where* they're anchored: the Stern-Gerlach sim laid a
// single chain out from a fixed left-edge oven; this sim has one oven in the
// middle emitting a pair, so both apparatuses are defined once in "local"
// coordinates (x = 0 at the oven's edge, +x = away from the oven, y = the
// same screen y everywhere) and then drawn twice -- once per side -- through
// a small coordinate transform (see withSide, below) that places and mirrors
// each copy without needing two separately-derived sets of formulas.
const OVEN_HEIGHT = 100;
const OVEN_WIDTH = Math.round(OVEN_HEIGHT * (1177 / 654));
const SG_WIDTH = 160;
const SG_HEIGHT = 90;
const SG_GAP = 98;   // gap between the oven's edge and the SG's near (input) edge -- matches the Stern-Gerlach sim's 300 - 50 - 152
const SG_X0_LOCAL = SG_GAP;
// From the SG image itself, to be used for path drawing (unchanged from the Stern-Gerlach sim)
const SG_INPUT_Y = 111 * (SG_HEIGHT / 225);
const SG_OUTPUT_UP = 66 * (SG_HEIGHT / 225);
const SG_OUTPUT_DOWN = 158 * (SG_HEIGHT / 225);
// PC (detector) image dimensions and label layout, also unchanged
const PC_HEIGHT = 50;
const PC_WIDTH = 100;
const PC_STRIPE_CENTER_X = 330 * (PC_WIDTH / 400);
const PC_STRIPE_WIDTH = 50 * (PC_WIDTH / 400);
const PC_STRIPE_ALPHA = 0.5;
const PC_TEXT_CENTER_X = 190 * (PC_WIDTH / 400);
const PC_COUNT_CENTER_Y = 132 * (PC_HEIGHT / 200) - PC_HEIGHT / 2;
const PC_LABEL_CENTER_Y = 50 * (PC_HEIGHT / 200) - PC_HEIGHT / 2;
const PC_HIGHLIGHT_PADDING = 6;
const PC_HIGHLIGHT_LINE_WIDTH = 3;

// Out-arc geometry (oven -> SG is a straight line; SG -> detector is this
// arc) -- same radius/angle the Stern-Gerlach sim uses for its own
// (aesthetic, not physically constrained) output arcs.
const OUT_PATH_ARC_RADIUS = 150;
const OUT_PATH_ARC_ANGLE = 0.7; // rad

// Particle animation specs -- all unchanged from the Stern-Gerlach sim
const PARTICLE_SPEED = 300;        // px/sec while visibly moving
const SG_PROCESSING_MS = 200;      // fixed pause while "inside" an SG
const BEAM_TRANSVERSE_WIDTH = 14;  // px, full spread of the (uniform) beam jitter
const PARTICLE_RADIUS = 4;
const PARTICLE_COLOR = '#3498db';

const SUB_LABELS = "₁₂₃₄₅₆₇₈₉";
function getSGLabel(angles, id) {
  if (angles[0] == 0) {
    return 'Z';
  } else if (angles[0] == Math.PI / 2) {
    if (angles[1] == 0) {
      return 'X';
    } else if (angles[1] == Math.PI / 2) {
      return 'Y';
    }
  }
  return 'n̂' + SUB_LABELS[id];
}

function useImage(src) {
  const imgRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
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

function imageReady(imgRef) {
  return imgRef.current !== null && imgRef.current.complete;
}

// The SG's own output arc, in local coordinates, always as if this were the
// *right*-hand apparatus (particles travelling in +x). withSide's ambient
// transform is what turns this into the correctly-mirrored left-hand
// version at draw/animate time -- see the comment on withSide.
function localArmArc(arm, axis) {
  const cx = SG_X0_LOCAL + SG_WIDTH;
  const outputY = axis - SG_HEIGHT / 2 + (arm === 'up' ? SG_OUTPUT_UP : SG_OUTPUT_DOWN);
  return arm === 'up'
    ? { cx, cy: outputY - OUT_PATH_ARC_RADIUS, r: OUT_PATH_ARC_RADIUS, startAngle: Math.PI / 2, endAngle: Math.PI / 2 - OUT_PATH_ARC_ANGLE, ccw: true }
    : { cx, cy: outputY + OUT_PATH_ARC_RADIUS, r: OUT_PATH_ARC_RADIUS, startAngle: -Math.PI / 2, endAngle: -Math.PI / 2 + OUT_PATH_ARC_ANGLE, ccw: false };
}

// Where a detector sits and how it's tilted, again always in the local,
// right-facing frame.
function localPlacementSite(arm, axis) {
  const cx = SG_X0_LOCAL + SG_WIDTH;
  const pcX0 = cx + OUT_PATH_ARC_RADIUS * Math.sin(OUT_PATH_ARC_ANGLE);
  const outputY = axis - SG_HEIGHT / 2 + (arm === 'up' ? SG_OUTPUT_UP : SG_OUTPUT_DOWN);
  return arm === 'up'
    ? { x: pcX0, y: outputY - OUT_PATH_ARC_RADIUS * (1 - Math.cos(OUT_PATH_ARC_ANGLE)), angle: -OUT_PATH_ARC_ANGLE }
    : { x: pcX0, y: outputY + OUT_PATH_ARC_RADIUS * (1 - Math.cos(OUT_PATH_ARC_ANGLE)), angle: OUT_PATH_ARC_ANGLE };
}

// Runs `drawFn` with the canvas context set up so that local coordinate
// (0, 0) sits at this side's own oven edge and local +x points away from
// the oven -- for the right side that's an ordinary translate, and for the
// left side it's a translate *plus* a horizontal flip (ctx.scale(-1, 1)).
// Everything drawn inside drawFn using local coordinates -- the SG image,
// its arcs, the detector sites and their rotation angles -- therefore comes
// out correctly mirrored on the left with no separately-derived "mirrored"
// formulas: the Canvas 2D transform does that work for free, the same way
// flipping a sprite horizontally always does. The one thing a raw flip
// breaks is legibility of any text drawn inside it (mirrored text reads
// backwards) -- drawUnflippedText, below, is the fix for that one case.
function withSide(ctx, side, ovenCenterX, drawFn) {
  const dir = side === 'R' ? 1 : -1;
  ctx.save();
  ctx.translate(ovenCenterX + dir * OVEN_WIDTH / 2, 0);
  ctx.scale(dir, 1);
  drawFn();
  ctx.restore();
}

// Draws `text` centered at local (x, y). On the right side this is just
// ctx.fillText; on the left side (already inside withSide's horizontal
// flip) it applies one more local flip first, which cancels the ambient one
// so the glyphs themselves come out right-reading -- while the translate
// that positions them still happens in the (mirrored) local frame, so the
// text still lands in the correct mirrored spot. Assumes textAlign/
// textBaseline are already set to 'center'/'middle' by the caller, which is
// the one alignment that reads the same whether or not this flips.
function drawUnflippedText(ctx, side, text, x, y) {
  if (side === 'R') {
    ctx.fillText(text, x, y);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Maps a point in one side's local coordinates (as used by localArmArc/
// localPlacementSite above) to actual canvas pixels -- the non-drawing
// equivalent of withSide's transform, used for particles in flight since
// their position is computed as plain numbers rather than issued as canvas
// drawing commands.
function localToScreen(side, ovenCenterX, localX, localY) {
  const dir = side === 'R' ? 1 : -1;
  return { x: ovenCenterX + dir * (OVEN_WIDTH / 2 + localX), y: localY };
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

// One particle's full animation path, in local coordinates: a straight run
// from the oven edge to the SG's input, a fixed pause "inside" the SG, then
// the output arc to whichever detector `arm` sends it to. Every particle
// here always ends at a detector -- there's no build mode, no beam blocks,
// no chain to run off the end of -- so this is considerably simpler than
// the Stern-Gerlach sim's buildAnimationPath, which had to handle all of
// those.
function buildLocalPath(axis, arm) {
  const sgInputLocalY = axis - SG_HEIGHT / 2 + SG_INPUT_Y;
  const offset = (Math.random() - 0.5) * BEAM_TRANSVERSE_WIDTH;
  const arc = localArmArc(arm, axis);
  return [
    { type: 'line', x0: 0, y0: sgInputLocalY + offset, x1: SG_X0_LOCAL, y1: sgInputLocalY + offset },
    { type: 'wait', x: SG_X0_LOCAL, y: sgInputLocalY + offset, ms: SG_PROCESSING_MS },
    { ...arc, r: arc.r + offset, type: 'arc' },
  ];
}

const LabPanel = forwardRef(function LabPanel(
  { experiment, setExperiment, expMode, displayBools, setParticleCount, resetToken, tabVisible, hoveredDetector },
  ref
) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [axis, setAxis] = useState(300); // y-coordinate of halfway down the canvas
  const [ovenImageRef, ovenImageLoaded] = useImage(ovenImage);
  const [ovenOffImageRef, ovenOffImageLoaded] = useImage(ovenOffImage);
  const [sgImageRef, sgImageLoaded] = useImage(sgImage);
  const [pcImageRef, pcImageLoaded] = useImage(pcImage);
  // Live, per-frame-mutated particle list -- deliberately a ref, not state,
  // so 60fps position updates don't re-render the whole app. particleCount
  // (a prop, real state owned by App) is the only piece of this the rest of
  // the UI needs to react to.
  const particlesRef = useRef([]);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(null);

  // Resize canvas to fill container -- identical devicePixelRatio handling
  // to the Stern-Gerlach sim's LabPanel; see its own comment for why.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = newWidth * dpr;
      canvas.height = newHeight * dpr;
      canvas.style.width = `${newWidth}px`;
      canvas.style.height = `${newHeight}px`;
      const resizedCtx = canvas.getContext('2d');
      resizedCtx.scale(dpr, dpr);
      resizedCtx.imageSmoothingQuality = 'high';

      setCanvasDims({ width: newWidth, height: newHeight });
      setAxis(newHeight / 2);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // Draws everything except in-flight particles: grid, oven, both SGs and
  // their four detectors. Called either from the state-driven effect below
  // (when idle) or every frame from the particle animation loop (while
  // particles exist), so there's one definition of "what the static scene
  // looks like" regardless of who's asking.
  const drawScene = useCallback((ctx) => {
    const { width, height } = canvasDims;
    const ovenCenterX = width / 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

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

    // One oven, centered, shared by both ports -- "on" (particles have been
    // requested) vs "off" mirrors the Stern-Gerlach sim's own two-image
    // convention.
    const ovenOn = expMode.running || particlesRef.current.length > 0;
    const ovenImg = ovenOn ? ovenImageRef : ovenOffImageRef;
    if (imageReady(ovenImg)) {
      ctx.drawImage(ovenImg.current, ovenCenterX - OVEN_WIDTH / 2, axis - OVEN_HEIGHT / 2, OVEN_WIDTH, OVEN_HEIGHT);
    }

    if (!imageReady(sgImageRef) || !imageReady(pcImageRef)) return;

    [{ side: 'L', sgIndex: 0 }, { side: 'R', sgIndex: 1 }].forEach(({ side, sgIndex }) => {
      const sg = experiment[sgIndex];

      withSide(ctx, side, ovenCenterX, () => {
        ctx.drawImage(sgImageRef.current, SG_X0_LOCAL, axis - SG_HEIGHT / 2, SG_WIDTH, SG_HEIGHT);

        ctx.fillStyle = '#303030';
        ctx.font = '32px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        drawUnflippedText(ctx, side, getSGLabel(sg.basis, sgIndex), SG_X0_LOCAL + 62, axis);

        ['up', 'down'].forEach((arm) => {
          const site = localPlacementSite(arm, axis);
          const detector = sg[arm];

          ctx.save();
          ctx.translate(site.x, site.y);
          ctx.rotate(site.angle);

          ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT);

          ctx.save();
          ctx.globalAlpha = PC_STRIPE_ALPHA;
          ctx.fillStyle = PC_COLORS[detector.colorId];
          ctx.fillRect(PC_STRIPE_CENTER_X - PC_STRIPE_WIDTH / 2, -PC_HEIGHT / 2, PC_STRIPE_WIDTH, PC_HEIGHT);
          ctx.restore();

          // "SGn" label with the direction arrow -- same wording the
          // histogram puts under each bar, so a detector reads identically
          // in both places. drawArrow's shape is left-right symmetric, so
          // (unlike text) it needs no unflipping of its own.
          ctx.fillStyle = '#666';
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          drawUnflippedText(ctx, side, `SG${sgIndex + 1}`, PC_TEXT_CENTER_X, PC_LABEL_CENTER_Y - 7);
          drawArrow(ctx, PC_TEXT_CENTER_X, PC_LABEL_CENTER_Y + 8, 11, arm === 'up' ? 'up' : 'down');

          // Running count
          ctx.fillStyle = PC_COLORS[detector.colorId];
          ctx.font = '12px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          drawUnflippedText(ctx, side, String(detector.data), PC_TEXT_CENTER_X, PC_COUNT_CENTER_Y);

          if (hoveredDetector && hoveredDetector.sgIndex === sgIndex && hoveredDetector.arm === arm) {
            ctx.strokeStyle = PC_COLORS[detector.colorId];
            ctx.lineWidth = PC_HIGHLIGHT_LINE_WIDTH;
            ctx.strokeRect(
              -PC_HIGHLIGHT_PADDING,
              -PC_HEIGHT / 2 - PC_HIGHLIGHT_PADDING,
              PC_WIDTH + PC_HIGHLIGHT_PADDING * 2,
              PC_HEIGHT + PC_HIGHLIGHT_PADDING * 2
            );
          }

          ctx.restore();
        });
      });
    });
  }, [experiment, expMode, displayBools, axis, canvasDims, hoveredDetector, pcImageRef, ovenImageRef, ovenOffImageRef, sgImageRef]);

  const drawParticles = useCallback((ctx) => {
    const ovenCenterX = canvasDims.width / 2;
    ctx.fillStyle = PARTICLE_COLOR;
    particlesRef.current.forEach((p) => {
      const seg = p.segments[p.segmentIndex];
      // 'wait' = "inside" the SG -- hidden rather than frozen at the input,
      // so it reads as continuing through rather than pausing at the door.
      if (!seg || seg.type === 'wait') return;
      const dur = (segmentLength(seg) / PARTICLE_SPEED) * 1000;
      const t = dur > 0 ? Math.min(p.segmentElapsed / dur, 1) : 1;
      const localPos = pointOnSegment(seg, t);
      const pos = localToScreen(p.side, ovenCenterX, localPos.x, localPos.y);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, PARTICLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [canvasDims]);

  // tickRef always points at a fresh closure over the current props/state --
  // see the Stern-Gerlach sim's LabPanel for why this indirection (rather
  // than a plain variable) is what keeps the recursive rAF loop from ever
  // reading stale values.
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

      // Every particle here always ends at a fixed detector -- there's no
      // beam block or open chain end to check for, unlike the Stern-Gerlach
      // sim's equivalent step.
      if (finished.length > 0) {
        setExperiment((prev) => {
          const next = [...prev];
          finished.forEach((p) => {
            const sgIndex = p.side === 'L' ? 0 : 1;
            next[sgIndex] = { ...next[sgIndex], [p.arm]: { ...next[sgIndex][p.arm], data: next[sgIndex][p.arm].data + 1 } };
          });
          return next;
        });
        particlesRef.current = particlesRef.current.filter((p) => !finished.includes(p));
        setParticleCount(particlesRef.current.length);
      }

      drawScene(ctx);
      drawParticles(ctx);

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

  // Pause the animation loop while the tab is hidden -- see the
  // Stern-Gerlach sim's LabPanel for why this matters (browser throttling
  // of background-tab timers vs. rAF would otherwise let particle
  // production and the animation loop drift out of sync).
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

  // Spawns one *pair*: both particles' arms are drawn together from the
  // joint singlet distribution (samplePairOutcome), then each gets its own
  // independent animation path -- same length on both sides (a straight run
  // plus one fixed-angle arc), so the pair reads as leaving the oven and
  // arriving at their detectors together.
  const spawnParticle = () => {
    const { armL, armR } = samplePairOutcome(experiment[0].basis, experiment[1].basis);
    particlesRef.current = [
      ...particlesRef.current,
      { side: 'L', arm: armL, segments: buildLocalPath(axis, armL), segmentIndex: 0, segmentElapsed: 0 },
      { side: 'R', arm: armR, segments: buildLocalPath(axis, armR), segmentIndex: 0, segmentElapsed: 0 },
    ];
    setParticleCount(particlesRef.current.length);
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
  }, [experiment, expMode, ovenImageLoaded, ovenOffImageLoaded, sgImageLoaded, pcImageLoaded, axis, canvasDims, displayBools, drawScene]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
});

export default LabPanel;
