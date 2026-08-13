import { useRef, useEffect, useState, useCallback } from 'react';
import { getComponentType } from './componentTypes.js';

// Side length (px) of one grid square -- also the full-scale placed size of
// every component image, and the size of the placement ghost in App.jsx.
export const GRID_SIZE = 64;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

let nextId = 1;
function makeComponentId() {
  return `c${nextId++}`;
}

// Pixel -> grid-cell conversion, clamped to whatever grid currently fits in
// the canvas. Returns null if the point falls outside the grid entirely.
function cellFromPoint(x, y, cols, rows) {
  const col = Math.floor(x / GRID_SIZE);
  const row = Math.floor(y / GRID_SIZE);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  return { col, row };
}

export default function LabPanel({ displayBools, buildMode, setBuildMode, components, setComponents }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [hoveredCell, setHoveredCell] = useState(null);

  // Existing-component dragging (move-after-placement). dragPos is the
  // component's free-following top-left position in canvas-local pixels
  // while the drag is in progress; the component snaps to a grid cell only
  // once the mouse is released.
  const [draggingId, setDraggingId] = useState(null);
  const [dragPos, setDragPos] = useState(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dragPosRef = useRef(null); // mirrors dragPos, read from the mouseup handler directly

  const setDragPosBoth = (pos) => {
    dragPosRef.current = pos;
    setDragPos(pos);
  };

  // Remove-mode drag-erase is tracked in a ref (not state) since it doesn't
  // need to trigger a re-render by itself -- only the resulting setComponents does.
  const removingRef = useRef(false);

  const cols = Math.max(1, Math.floor(canvasDims.width / GRID_SIZE));
  const rows = Math.max(1, Math.floor(canvasDims.height / GRID_SIZE));

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
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // Drawing: grid lines plus a highlight over whichever cell the mouse is
  // hovering while placing or removing a component.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = displayBools.gridOn ? '#e0e0e0' : '#ffffff';
    ctx.lineWidth = 1;
    for (let i = 0; i <= canvas.width; i += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(i + 0.5, 0);
      ctx.lineTo(i + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let j = 0; j <= canvas.height; j += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, j + 0.5);
      ctx.lineTo(canvas.width, j + 0.5);
      ctx.stroke();
    }

    if (hoveredCell && (buildMode?.place || buildMode === 'remove')) {
      const occupied = components.some((c) => c.col === hoveredCell.col && c.row === hoveredCell.row);
      let fill;
      if (buildMode === 'remove') {
        fill = occupied ? 'rgba(231, 76, 60, 0.35)' : 'rgba(231, 76, 60, 0.12)';
      } else {
        fill = occupied ? 'rgba(231, 76, 60, 0.25)' : 'rgba(52, 152, 219, 0.25)';
      }
      ctx.fillStyle = fill;
      ctx.fillRect(hoveredCell.col * GRID_SIZE, hoveredCell.row * GRID_SIZE, GRID_SIZE, GRID_SIZE);
    }
  }, [components, canvasDims, displayBools, buildMode, hoveredCell]);

  const eraseAtClientPos = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cell = cellFromPoint(clientX - rect.left, clientY - rect.top, cols, rows);
    if (!cell) return;
    setComponents((prev) => prev.filter((c) => !(c.col === cell.col && c.row === cell.row)));
  }, [cols, rows, setComponents]);

  // Placement (click to drop an armed component) and remove-mode's initial
  // click both happen on mousedown, so a plain click removes one component
  // while a press-and-drag erases everything the cursor passes over.
  const handleCanvasMouseDown = (e) => {
    if (buildMode === 'remove') {
      removingRef.current = true;
      eraseAtClientPos(e.clientX, e.clientY);
    }
  };

  const handleCanvasClick = (e) => {
    if (!buildMode?.place) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cell = cellFromPoint(e.clientX - rect.left, e.clientY - rect.top, cols, rows);
    if (!cell) return;
    if (components.some((c) => c.col === cell.col && c.row === cell.row)) return; // occupied
    setComponents((prev) => [...prev, { id: makeComponentId(), type: buildMode.place, col: cell.col, row: cell.row }]);
    setBuildMode(null); // single-shot placement, same as the Stern-Gerlach sim's build mode
  };

  const handleCanvasMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setHoveredCell(cellFromPoint(e.clientX - rect.left, e.clientY - rect.top, cols, rows));
  };

  const handleCanvasMouseLeave = () => setHoveredCell(null);

  // Continue a remove-mode drag-erase even if the mouse briefly leaves the
  // canvas, and always release it on mouseup wherever that happens.
  useEffect(() => {
    if (buildMode !== 'remove') return;
    const onMove = (e) => {
      if (removingRef.current) eraseAtClientPos(e.clientX, e.clientY);
    };
    const onUp = () => {
      removingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [buildMode, eraseAtClientPos]);

  // A placed component's own <img> sits on top of the canvas, so a
  // mousedown that lands on it never reaches handleCanvasMouseDown -- while
  // removing, handle the erase here directly instead of starting a drag.
  const handleComponentMouseDown = (e, comp) => {
    if (buildMode === 'remove') {
      e.stopPropagation();
      removingRef.current = true;
      setComponents((prev) => prev.filter((c) => c.id !== comp.id));
      return;
    }
    startDrag(e, comp);
  };

  // Moving an already-placed component: free-follow the cursor, then snap
  // to the nearest grid cell on release (reverting if that cell is taken).
  const startDrag = (e, comp) => {
    if (buildMode) return; // don't fight with placement/remove mode
    e.stopPropagation();
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    dragOffsetRef.current = {
      x: (e.clientX - rect.left) - comp.col * GRID_SIZE,
      y: (e.clientY - rect.top) - comp.row * GRID_SIZE,
    };
    setDraggingId(comp.id);
    setDragPosBoth({ x: comp.col * GRID_SIZE, y: comp.row * GRID_SIZE });
  };

  useEffect(() => {
    if (draggingId == null) return;

    const onMove = (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      setDragPosBoth({
        x: (e.clientX - rect.left) - dragOffsetRef.current.x,
        y: (e.clientY - rect.top) - dragOffsetRef.current.y,
      });
    };

    // Reads dragPosRef directly rather than a setDragPos functional updater --
    // updater functions must stay pure (React may invoke them speculatively,
    // e.g. under StrictMode), so the setComponents side effect below can't
    // safely live inside one.
    const onUp = () => {
      const pos = dragPosRef.current;
      if (pos) {
        const col = clamp(Math.round(pos.x / GRID_SIZE), 0, cols - 1);
        const row = clamp(Math.round(pos.y / GRID_SIZE), 0, rows - 1);
        setComponents((prev) => {
          const occupied = prev.some((c) => c.id !== draggingId && c.col === col && c.row === row);
          return prev.map((c) => (c.id === draggingId && !occupied ? { ...c, col, row } : c));
        });
      }
      setDragPosBoth(null);
      setDraggingId(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingId, cols, rows, setComponents]);

  const cursor = buildMode?.place || buildMode === 'remove' ? 'crosshair' : 'default';

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
        style={{ cursor, display: 'block', touchAction: 'none' }}
      />
      {components.map((comp) => {
        const type = getComponentType(comp.type);
        const isDragging = comp.id === draggingId;
        const x = isDragging && dragPos ? dragPos.x : comp.col * GRID_SIZE;
        const y = isDragging && dragPos ? dragPos.y : comp.row * GRID_SIZE;
        return (
          <img
            key={comp.id}
            src={type.image}
            alt={type.label}
            className={`placed-component ${isDragging ? 'dragging' : ''}`}
            style={{ left: x, top: y, width: GRID_SIZE, height: GRID_SIZE }}
            draggable="false"
            onMouseDown={(e) => handleComponentMouseDown(e, comp)}
          />
        );
      })}
    </div>
  );
}
