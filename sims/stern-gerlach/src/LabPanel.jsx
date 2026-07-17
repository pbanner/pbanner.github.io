import React, { useRef, useEffect, useState } from 'react';
import sgImage from './assets/SG.png';

const SG_WIDTH = 160;
const SG_HEIGHT = 90;
const SG_SPACING = 300;   // horizontal gap between apparatus centers
const SG_START_X = 150;   // x-position of the first apparatus

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

export default function LabPanel({ experiment, setExperiment, displayBools }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // Used for mouse dragging events
  const [axis, setAxis] = useState(300); // y-coordinate of halfway down the canvas; determines position of all user-created devices
  // This ref holds the SG image for all time
  const sgImageRef = useRef(null);
  const [sgImageLoaded, setSgImageLoaded] = useState(false);

  // Resize canvas to fill container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Load the SG image once. This never touches the DOM — it's just an
    // in-memory Image object we hand to ctx.drawImage as many times as we want.
    const img = new Image();
    img.src = sgImage;
    img.onload = () => {
      sgImageRef.current = img;
      setSgImageLoaded(true);   // triggers a redraw now that it's actually ready
    };

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
        ctx.drawImage(sgImageRef.current, x0, axis - SG_HEIGHT / 2, SG_WIDTH, SG_HEIGHT);
        ctx.fillStyle = '#303030';
        ctx.font = '32px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(getSGLabel(sg.basis, i), x0+62, axis);
      });
    }
  }, [experiment, sgImageLoaded, axis, canvasDims, displayBools]);

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