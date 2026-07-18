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
const SG_INPUT_Y = 111*(SG_HEIGHT/225);
const SG_OUTPUT_UP = 66*(SG_HEIGHT/225);
const SG_OUTPUT_DOWN = 158*(SG_HEIGHT/225);
// PC image dimensions and specs for use throughout
const PC_HEIGHT = 50;
const PC_WIDTH = 100;
const PC_INPUT = PC_HEIGHT/2;
const BB_HEIGHT = 50;
const BB_WIDTH = 9;
const BB_INPUT = BB_HEIGHT/2;
// Path specs for particles
// In path constrained by SG spacing and geometry
const IN_PATH_ARC_ANGLE = Math.atan(Math.abs(SG_INPUT_Y - SG_OUTPUT_UP)/Math.abs(SG_SPACING - SG_WIDTH));
const IN_PATH_ARC_RADIUS = Math.abs(SG_SPACING - SG_WIDTH)/Math.sin(IN_PATH_ARC_ANGLE);
// Out path not constrained, radius and angle chosen for aesthetics
const OUT_PATH_ARC_RADIUS = 150;
const OUT_PATH_ARC_ANGLE = 0.7; // rad
// Snap radius for UI
const SNAP_RADIUS = 50;  // px — how close the cursor must be to snap

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

      const width = sg[arm] === 'pc' ? PC_WIDTH : BB_WIDTH;
      const height = sg[arm] === 'pc' ? PC_HEIGHT : BB_HEIGHT;
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

export default function LabPanel({ experiment, setExperiment, expMode, setExpMode, counts, setCounts, displayBools }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // Used for mouse dragging events
  const [axis, setAxis] = useState(300); // y-coordinate of halfway down the canvas; determines position of all user-created devices
  // These refs hold the SG and PC images for all time, using the loading hook
  const [sgImageRef, sgImageLoaded] = useImage(sgImage);
  const [pcImageRef, pcImageLoaded] = useImage(pcImage);
  const [bbImageRef, bbImageLoaded] = useImage(bbImage);
  // This holds positions for a preview image or for checking component deletion ranges, as needed
  const [mousePos, setMousePos] = useState(null); // null = no preview to show right now and not in deletion mode

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

        // Draw the out path arcs (temporary)
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

        // Draw the in path arcs (temporary)
        // ctx.strokeStyle = '#303030';
        // ctx.setLineDash([10, 8]);
        // ctx.lineWidth = 1.5;

        // ctx.beginPath();
        // ctx.arc(
        //   x0 + SG_WIDTH, 
        //   axis - (SG_HEIGHT/2) + SG_OUTPUT_UP + IN_PATH_ARC_RADIUS, 
        //   IN_PATH_ARC_RADIUS, -Math.PI/2, -Math.PI/2 + IN_PATH_ARC_ANGLE, false);
        // ctx.stroke();

        // ctx.beginPath();
        // ctx.arc(
        //   x0 + SG_WIDTH, 
        //   axis - (SG_HEIGHT/2) + SG_OUTPUT_DOWN - IN_PATH_ARC_RADIUS, 
        //   IN_PATH_ARC_RADIUS, Math.PI/2, Math.PI/2 - IN_PATH_ARC_ANGLE, true);
        // ctx.stroke();

        // ctx.setLineDash([]); // Reset to solid lines

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
            sg[arm] === 'pc' ? ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT / 2, PC_WIDTH, PC_HEIGHT) : ctx.drawImage(bbImageRef.current, 0, -BB_HEIGHT / 2, BB_WIDTH, BB_HEIGHT);
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
            const width = sg[arm] === 'pc' ? PC_WIDTH : BB_WIDTH;
            const height = sg[arm] === 'pc' ? PC_HEIGHT : BB_HEIGHT;
            const site = getPlacementSite(target.sgIndex, arm, axis);
            const armCenter = getPlacementSiteCenter(site, width);
            ctx.beginPath();
            ctx.arc(armCenter.x, armCenter.y, (Math.max(width, height) / 2) * DELETE_MARGIN, 0, Math.PI * 2);
            ctx.stroke();
          });
        }
      }
    }
  }, [experiment, expMode, sgImageLoaded, pcImageLoaded, mousePos, axis, canvasDims, displayBools]);

  // Mouse handlers
  const handleClick = (e) => {
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
      return;
    }

    const snapped = findNearestPlacementSite(mouseX, mouseY, experiment, axis, expMode.build === 1 ? PC_WIDTH : BB_WIDTH);
    if (!snapped) return;

    const { sgIndex, arm } = snapped;
    setExperiment((prev) => {
      const next = [...prev];
      next[sgIndex] = { ...next[sgIndex], [arm]: expMode.build === 1 ? 'pc' : 'bb' };
      return next;
    });
    if (expMode.build === 1) {
      setCounts([ ...counts, { sg: sgIndex, arm: arm, data: 0, colorId: 0 } ]);
    }
  };

  const handleMouseMove = (e) => {
    if (expMode.build === 0 || expMode.running === true) {
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