import React, { useRef, useEffect, useState } from 'react';
import './App.css';

export default function App() {
  const canvasRef = useRef(null);
  const [circle, setCircle] = useState({ x: 200, y: 200, radius: 5 });
  const [draggingCircle, setDraggingCircle] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rayAngle, setRayAngle] = useState(0);  // Angle measured ccw from rightward horizontal
  const [draggingRays, setDraggingRays] = useState(false);
  const [isRed, setIsRed] = useState(false);
  const [gridOn, setGridOn] = useState(true);

  // Draw the circle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid (optional, just for reference)
    ctx.strokeStyle = gridOn ? '#e0e0e0' : '#f0f0f0';
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
    ctx.fillStyle = isRed ? '#e74c3c' : '#3498db';  // ← Changes based on isRed state
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw circle outline
    ctx.strokeStyle = '#2980b9';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw rays
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 1;
    for (let i = -2*Math.PI/180.0; i < 3*Math.PI/180.0; i += 2*Math.PI/180.0) {
      ctx.beginPath();
      ctx.moveTo(circle.x, circle.y);
      ctx.lineTo(circle.x + 250*Math.cos(rayAngle+i), circle.y + 250*Math.sin(rayAngle+i));
      ctx.stroke()
    }

  }, [circle, isRed, gridOn, rayAngle]);

  // Handle mouse down
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const dist = Math.sqrt((mouseX - circle.x) ** 2 + (mouseY - circle.y) ** 2);
    const angleClick = Math.atan2(mouseY - circle.y, mouseX - circle.x);

    // Check if clicked inside circle
    if (dist < circle.radius) {
      setDraggingCircle(true);
      setOffset({
        x: mouseX - circle.x,
        y: mouseY - circle.y,
      });
    // Check if clicked in the rays' path
    } else if ((dist < 250) && (Math.abs(angleClick - rayAngle) <= 3.0*Math.PI/180.0)) {
      setDraggingRays(true);
      setOffset({
        x: mouseX - circle.x,
        y: mouseY - circle.y,
      });
    }
  };

  // Handle mouse move
  const handleMouseMove = (e) => {
    if (!(draggingCircle || draggingRays)) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (draggingCircle) {
      setCircle({
        ...circle,
        x: mouseX - offset.x,
        y: mouseY - offset.y,
      });
    } else if (draggingRays) {
      let offsetAngle = Math.atan2(offset.y, offset.x);
      setRayAngle(Math.atan2(mouseY - circle.y, mouseX - circle.x) - offsetAngle);
    }
  };

  // Handle mouse up
  const handleMouseUp = () => {
    setDraggingCircle(false);
    setDraggingRays(false);
  };

  return (
    <div className="container">
      <h1>Draggable Circle Simulator</h1>
      <p>Click and drag the blue circle around the canvas</p>
      <div style={{ marginBottom: '20px' }}>
        <label>
          <input
            type="checkbox"
            checked={isRed}
            onChange={(e) => setIsRed(e.target.checked)}
          />
          Make circle red
        </label>

        <label>
          <input
            type="checkbox"
            checked={gridOn}
            onChange={(e) => setGridOn(e.target.checked)}
          />
          Grid visible
        </label>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ border: '2px solid #333', cursor: (draggingCircle || draggingRays) ? 'grabbing' : 'grab' }}
      />
      <div className="info">
        Position: ({circle.x.toFixed(0)}, {circle.y.toFixed(0)})
      </div>
    </div>
  );
}