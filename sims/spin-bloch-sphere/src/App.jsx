import React, { useRef, useEffect, useState } from 'react';
import './App.css';

export function SpherePanel({ controlBools }) {
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
    ctx.strokeStyle = '#e0e0e0';
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
  }, [circle, circleColor, canvasDims, controlBools]);

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

export default function App() {
  const [controlBools, setControlBools] = useState({
    showSphere: true,             // Displaying the sphere
    advancedBField: false         // For when the user is specifying an advanced magnetic field
  });
  // Spin state at t = 0, set by two angles
  const [initialSpinState, setInitialSpinState] = useState({ theta: 0, phi: 0 });
  // Every element of this array should have a theta, phi, magnitude, and omega specifying it
  const [magneticField, setMagneticField] = useState([{ mag: 0, theta: 0, phi: 0, omega: 0 }]);

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        <SpherePanel controlBools={controlBools} />
      </div>

      {/* Right Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-content">
          <div className="panel-controls">
            <div>
              <h3>Instructions and Controls</h3>
              <p>Drag the object or eye around and watch if and where a virtual image is visible!
              If desired, right-click in the simulation area to save an image of the current setup.
              Rotate the mirror and explore other controls below!</p>

              <div className="control-group" style={{ marginTop: '1.0em', marginBottom: '1.5em' }}>
                <label style={{ justifyContent: 'center' }}>Mirror angle: {(magneticField[0].theta * 180 / Math.PI).toFixed(1)}°</label>
                <input
                  type="range"
                  min={-Math.PI}
                  max={Math.PI}
                  step="0.01"
                  value={magneticField[0].theta}
                  onChange={(e) => setMagneticField([{ mag: 0, theta: e.target.value, phi: 0, omega: 0 }])}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="control-group" style={{ marginTop: '1.0em' }}>
                <button className={`control-button ${controlBools.showSphere ? 'active' : ''}`} onClick={() => setControlBools({ ...controlBools, showSphere: !controlBools.showSphere })}>
                  {controlBools.showSphere ? 'Hide sphere' : 'Show sphere'}
                </button>
              </div>

              <div className="control-group" style={{ marginTop: '1.0em' }}>
                <button className={`control-button ${controlBools.advancedBField ? 'active-special' : ''}`} onClick={() => setControlBools({ ...controlBools, advancedBField: !controlBools.advancedBField })}>
                  Advanced
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}