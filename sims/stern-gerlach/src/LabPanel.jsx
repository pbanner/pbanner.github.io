import React, { useRef, useEffect, useState } from 'react';
import sgImage from './assets/SG.png';
import pcImage from './assets/PC.png';
import bbImage from './assets/BB.png';

// SG image dimensions and specs for use throughout
const SG_WIDTH = 160;
const SG_HEIGHT = 90;
const SG_SPACING = 300;   // horizontal gap between apparatus centers
const SG_START_X = 150;   // x-position of the first apparatus
// From the image itself, to be used for path drawing
const SG_INPUT_Y = 111;
const SG_OUTPUT_UP = 66*(SG_HEIGHT/225);
const SG_OUTPUT_DOWN = 158*(SG_HEIGHT/225);
// PC image dimensions and specs for use throughout
const PC_HEIGHT = 50;
const PC_WIDTH = 100;
const PC_INPUT = PC_HEIGHT/2;

// Path specs for particles
const OUT_PATH_ARC_RADIUS = 150;
const OUT_PATH_ARC_ANGLE = 0.7; // rad
const NEW_DEVICE_SNAP_RADIUS = 50;  // px — how close the cursor must be to snap

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
  return 'n\u0302'+SUB_LABELS[id];
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
// (PC_WIDTH/2, 0) by the site's angle to get the point to snap-test against.
function getPlacementSiteCenter(site) {
  return {
    x: site.x + (PC_WIDTH / 2) * Math.cos(site.angle),
    y: site.y + (PC_WIDTH / 2) * Math.sin(site.angle),
  };
}

// Pure function: given a mouse position, find the nearest unoccupied
// placement site within snapping distance, or null if none qualify.
function findNearestSite(mouseX, mouseY, experiment, axis) {
  let closest = null;
  let closestDist = NEW_DEVICE_SNAP_RADIUS;

  experiment.forEach((sg, sgIndex) => {
    ['up', 'down'].forEach((arm) => {
      if (sg[arm] === 'pc') return; // already occupied, not a candidate

      const site = getPlacementSite(sgIndex, arm, axis);
      const center = getPlacementSiteCenter(site);
      const dist = Math.hypot(mouseX - center.x, mouseY - center.y);

      if (dist < closestDist) {
        closestDist = dist;
        closest = { sgIndex, arm, site };
      }
    });
  });

  return closest;
}

export default function LabPanel({ experiment, setExperiment, expMode, setExpMode, displayBools }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // Used for mouse dragging events
  const [axis, setAxis] = useState(300); // y-coordinate of halfway down the canvas; determines position of all user-created devices
  // These refs hold the SG and PC images for all time, using the loading hook
  const [sgImageRef, sgImageLoaded] = useImage(sgImage);
  const [pcImageRef, pcImageLoaded] = useImage(pcImage);
  // This holds positions for a preview image as needed
  const [pcPreviewPos, setPcPreviewPos] = useState(null); // null = no preview to show right now

  // Resize canvas to fill container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      canvas.width = newWidth;
      canvas.height = newHeight;
      setCanvasDims({ width: newWidth, height: newHeight });

      const halfwayY = newHeight / 2;
      setAxis(halfwayY);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // Drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = displayBools.gridOn ? '#e0e0e0' : '#ffffff';
    ctx.lineWidth = 1;
    for (let i = 0; i <= canvas.width; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i <= canvas.height; i += 50) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    // Draw the SGs, one copy of the ref image each, plus the basis labels
    if (sgImageRef.current && sgImageRef.current.complete) {
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

        // Draw the path arcs (temporary)
        // ctx.strokeStyle = '#303030';
        // ctx.setLineDash([10, 8]);
        // ctx.lineWidth = 1.5;

        // ctx.beginPath();
        // ctx.arc(
        //   x0 + SG_WIDTH, 
        //   axis - (SG_HEIGHT/2) + SG_OUTPUT_UP - OUT_PATH_ARC_RADIUS, 
        //   OUT_PATH_ARC_RADIUS, Math.PI/2, Math.PI/2 - OUT_PATH_ARC_ANGLE, true);
        // ctx.stroke();

        // ctx.beginPath();
        // ctx.arc(
        //   x0 + SG_WIDTH, 
        //   axis - (SG_HEIGHT/2) + SG_OUTPUT_DOWN + OUT_PATH_ARC_RADIUS, 
        //   OUT_PATH_ARC_RADIUS, -Math.PI/2, -Math.PI/2 + OUT_PATH_ARC_ANGLE, false);
        // ctx.stroke();

        // ctx.setLineDash([]); // Reset to solid lines

        //if (expMode.build === 'pc-place' || expMode.build === 'normal') {
        // Draw SGs and BBs as needed
        ['up', 'down'].forEach((arm) => {
          if (expMode.build === 'normal' && sg[arm] === null) return;
          // We're drawing SOMETHING
          const site = getPlacementSite(i, arm, axis);
          ctx.save();
          ctx.translate(site.x, site.y);
          ctx.rotate(site.angle);
          if (sg[arm] !== null) {
            // Draw only PC for now; when we add BBs, make a switch between pcImageRef and bbImageRef
            ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT);
          } else {
            // If we've reached this point, we're previewing sites
            ctx.globalAlpha = 0.5;
            // Again, draw only PCs for now; when we add BBs, make a expMode.build switch between 'place-pc' and 'place-bb'
            ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT);
            ctx.globalAlpha = 1.0;
          }
          ctx.restore();
        });
      });
    }

    // Draw any dragging preview stuff
    if (expMode.build === 'pc-place' && pcPreviewPos && pcImageRef.current && pcImageRef.current.complete) {
      const snapped = findNearestSite(pcPreviewPos.x, pcPreviewPos.y, experiment, axis);

      if (snapped) {
        ctx.save();
        ctx.translate(snapped.site.x, snapped.site.y);
        ctx.rotate(snapped.site.angle);
        ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT);
        ctx.restore();
      } else {
        ctx.drawImage(
          pcImageRef.current,
          pcPreviewPos.x - PC_WIDTH / 2,
          pcPreviewPos.y - PC_HEIGHT / 2,
          PC_WIDTH,
          PC_HEIGHT
        );
      }
    }
  }, [experiment, expMode, sgImageLoaded, pcImageLoaded, pcPreviewPos, axis, canvasDims, displayBools]);

  // Mouse handlers
  const handleClick = (e) => {
    if (expMode.build !== 'pc-place') return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const snapped = findNearestSite(mouseX, mouseY, experiment, axis);
    if (!snapped) return; // clicked somewhere that isn't near a site — no-op

    const { sgIndex, arm } = snapped;
    setExperiment((prev) => {
      const next = [...prev];
      next[sgIndex] = { ...next[sgIndex], [arm]: 'pc' };
      return next;
    });
  };

  const handleMouseMove = (e) => {
    if (expMode.build === 'normal' || expMode.build === 'running') {
      setPcPreviewPos(null);
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (expMode.build === 'pc-place') {
      setPcPreviewPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  const handleMouseLeave = () => {
    setPcPreviewPos(null)
  }

  // const handleMouseUp = () => {
  //   setDraggingCircle(false);
  // };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{
          //cursor: draggingCircle ? 'grabbing' : 'grab',
          display: 'block',
          touchAction: 'none',
        }}
      />
    </div>
  );
}