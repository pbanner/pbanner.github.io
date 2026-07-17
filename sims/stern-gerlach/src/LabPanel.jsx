import React, { useRef, useEffect, useState } from 'react';
import sgImage from './assets/SG.png';
import pcImage from './assets/PC.png';

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

export default function LabPanel({ experiment, setExperiment, expMode, setExpMode, displayBools }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // Used for mouse dragging events
  const [axis, setAxis] = useState(300); // y-coordinate of halfway down the canvas; determines position of all user-created devices
  // This ref holds the SG image for all time
  const [sgImageRef, sgImageLoaded] = useImage(sgImage);
  // And this holds the particle counter image for all time
  const [pcImageRef, pcImageLoaded] = useImage(pcImage);

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
        const pathArcRadius = 150;
        const pathArcAngle = 0.7; // rad

        // ctx.strokeStyle = '#303030';
        // ctx.setLineDash([10, 8]);
        // ctx.lineWidth = 1.5;

        // ctx.beginPath();
        // ctx.arc(
        //   x0 + SG_WIDTH, 
        //   axis - (SG_HEIGHT/2) + SG_OUTPUT_UP - pathArcRadius, 
        //   pathArcRadius, Math.PI/2, Math.PI/2 - pathArcAngle, true);
        // ctx.stroke();

        // ctx.beginPath();
        // ctx.arc(
        //   x0 + SG_WIDTH, 
        //   axis - (SG_HEIGHT/2) + SG_OUTPUT_DOWN + pathArcRadius, 
        //   pathArcRadius, -Math.PI/2, -Math.PI/2 + pathArcAngle, false);
        // ctx.stroke();

        // ctx.setLineDash([]); // Reset to solid lines

        if (expMode.build === 'pc-place') {
          const pcX0 = x0 + SG_WIDTH + pathArcRadius*Math.sin(pathArcAngle);
          ctx.globalAlpha = 0.5;

          ctx.save();
          ctx.translate(pcX0, axis - SG_HEIGHT/2 + SG_OUTPUT_UP - pathArcRadius*(1-Math.cos(pathArcAngle)));
          ctx.rotate(-pathArcAngle);
          ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT/2, PC_WIDTH, PC_HEIGHT);
          ctx.restore();

          ctx.save();
          ctx.translate(pcX0, axis - SG_HEIGHT/2 + SG_OUTPUT_DOWN + pathArcRadius*(1-Math.cos(pathArcAngle)));
          ctx.rotate(pathArcAngle);
          ctx.drawImage(pcImageRef.current, 0, -PC_HEIGHT/2, PC_WIDTH, PC_HEIGHT);
          ctx.restore();

          ctx.globalAlpha = 1.0;
        }
      });
    }
  }, [experiment, expMode, sgImageLoaded, pcImageLoaded, axis, canvasDims, displayBools]);

  // Mouse handlers
  // const handleMouseDown = (e) => {
  //   const canvas = canvasRef.current;
  //   const rect = canvas.getBoundingClientRect();
  //   const mouseX = e.clientX - rect.left;
  //   const mouseY = e.clientY - rect.top;

  //   const dist = Math.sqrt((mouseX - circle.x) ** 2 + (mouseY - circle.y) ** 2);

  //   if (dist < circle.radius + 5) {
  //     setDraggingCircle(true);
  //     setOffset({
  //       x: mouseX - circle.x,
  //       y: mouseY - circle.y,
  //     });
  //   }
  // };

  // const handleMouseMove = (e) => {
  //   if (!draggingCircle) return;

  //   const canvas = canvasRef.current;
  //   const rect = canvas.getBoundingClientRect();
  //   const mouseX = e.clientX - rect.left;
  //   const mouseY = e.clientY - rect.top;

  //   setCircle({
  //     ...circle,
  //     x: Math.max(circle.radius, Math.min(canvas.width - circle.radius, mouseX - offset.x)),
  //     y: Math.max(circle.radius, Math.min(canvas.height - circle.radius, mouseY - offset.y)),
  //   });
  // };

  // const handleMouseUp = () => {
  //   setDraggingCircle(false);
  // };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        //onMouseDown={handleMouseDown}
        //onMouseMove={handleMouseMove}
        //onMouseUp={handleMouseUp}
        //onMouseLeave={handleMouseUp}
        style={{
          //cursor: draggingCircle ? 'grabbing' : 'grab',
          display: 'block',
          touchAction: 'none',
        }}
      />
    </div>
  );
}