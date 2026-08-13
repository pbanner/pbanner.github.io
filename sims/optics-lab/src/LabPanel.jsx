import React, { useRef, useEffect, useState } from 'react';

export default function LabPanel({ displayBools }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [circle, setCircle] = useState({ x: 300, y: 200, radius: 8 });
  const [draggingCircle, setDraggingCircle] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [circleColor, setCircleColor] = useState(false);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });

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
      setCanvasDims({ width: newWidth, height: newHeight }); // Trigger redraw
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

    // Draw circle
    ctx.fillStyle = circleColor ? '#e74c3c' : '#39db34';
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    ctx.fill();

    // Draw circle outline
    ctx.strokeStyle = circleColor ? '#c0392b' : '#2bb929';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [circle, circleColor, canvasDims, displayBools]);

  // Mouse handlers
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const dist = Math.sqrt((mouseX - circle.x) ** 2 + (mouseY - circle.y) ** 2);

    if (dist < circle.radius + 5) {
      setDraggingCircle(true);
      setOffset({
        x: mouseX - circle.x,
        y: mouseY - circle.y,
      });
    }
  };

  const handleMouseMove = (e) => {
    if (!draggingCircle) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setCircle({
      ...circle,
      x: Math.max(circle.radius, Math.min(canvas.width - circle.radius, mouseX - offset.x)),
      y: Math.max(circle.radius, Math.min(canvas.height - circle.radius, mouseY - offset.y)),
    });
  };

  const handleMouseUp = () => {
    setDraggingCircle(false);
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          cursor: draggingCircle ? 'grabbing' : 'grab',
          display: 'block',
          touchAction: 'none',
        }}
      />
    </div>
  );
}