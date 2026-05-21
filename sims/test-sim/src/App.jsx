import React, { useRef, useEffect, useState } from 'react';
import './App.css';

export default function App() {
  const canvasRef = useRef(null);
  const [circle, setCircle] = useState({ x: 200, y: 200, radius: 30 });
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Draw the circle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid (optional, just for reference)
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 50) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }
    
    // Draw circle
    ctx.fillStyle = '#3498db';
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw circle outline
    ctx.strokeStyle = '#2980b9';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [circle]);

  // Handle mouse down
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Check if clicked inside circle
    const dist = Math.sqrt(
      (mouseX - circle.x) ** 2 + (mouseY - circle.y) ** 2
    );

    if (dist < circle.radius) {
      setDragging(true);
      setOffset({
        x: mouseX - circle.x,
        y: mouseY - circle.y,
      });
    }
  };

  // Handle mouse move
  const handleMouseMove = (e) => {
    if (!dragging) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setCircle({
      ...circle,
      x: mouseX - offset.x,
      y: mouseY - offset.y,
    });
  };

  // Handle mouse up
  const handleMouseUp = () => {
    setDragging(false);
  };

  return (
    <div className="container">
      <h1>Draggable Circle Simulator</h1>
      <p>Click and drag the blue circle around the canvas</p>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ border: '2px solid #333', cursor: dragging ? 'grabbing' : 'grab' }}
      />
      <div className="info">
        Position: ({circle.x.toFixed(0)}, {circle.y.toFixed(0)})
      </div>
    </div>
  );
}