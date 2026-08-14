import { useRef, useEffect, useState, useCallback } from 'react';
import { getComponentType, getDefaultFootprint, getRotatedFootprint } from './componentTypes.js';

// Side length (px) of one grid square -- also the placed size of a single-
// cell component, and the size of the placement ghost in App.jsx. Larger
// components (see COMPONENT_TYPES' footprint) are placed sized in multiples
// of this.
export const GRID_SIZE = 64;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

let nextId = 1;
function makeComponentId() {
  return `c${nextId++}`;
}
// If weird component bugs persis, can try this alternative:
// function makeComponentId() {
//   return crypto.randomUUID();
// }

// Pixel -> grid-cell conversion, clamped to whatever grid currently fits in
// the canvas. Returns null if the point falls outside the grid entirely.
function cellFromPoint(x, y, cols, rows) {
  const col = Math.floor(x / GRID_SIZE);
  const row = Math.floor(y / GRID_SIZE);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  return { col, row };
}

// Whether two axis-aligned footprints (each in grid-cell units) overlap at all.
function footprintsOverlap(aCol, aRow, aW, aH, bCol, bRow, bW, bH) {
  return aCol < bCol + bW && aCol + aW > bCol && aRow < bRow + bH && aRow + aH > bRow;
}

// Whether a w×h footprint anchored at (col, row) both fits on the current
// grid and doesn't overlap any existing component (other than excludeId --
// used so a component doesn't collide with its own current cells while
// being dragged or rotated).
function isFootprintFree(components, col, row, w, h, excludeId, cols, rows) {
  if (col < 0 || row < 0 || col + w > cols || row + h > rows) return false;
  return !components.some((c) => {
    if (c.id === excludeId) return false;
    const ft = getRotatedFootprint(getComponentType(c.type), c.rotation);
    return footprintsOverlap(col, row, w, h, c.col, c.row, ft.w, ft.h);
  });
}

// Whether comp could rotate 90° clockwise right now, staying anchored at
// its current (col, row). Always true for a square (1×1) footprint -- its
// own cells never change, so isFootprintFree's excludeId always covers it
// -- so this only ever actually blocks a non-square footprint like the
// laser's.
function canRotateComponent(components, comp, cols, rows) {
  const nextRotation = (comp.rotation + 90) % 360;
  const ft = getRotatedFootprint(getComponentType(comp.type), nextRotation);
  return isFootprintFree(components, comp.col, comp.row, ft.w, ft.h, comp.id, cols, rows);
}

// A rotated component is rendered at its *default* (rotation-0) pixel size
// with a plain CSS transform: rotate() -- simplest way to get a correct
// rotation animation/appearance for free. That means the image's own CSS
// box never changes size, so at 90°/270° (where the logical footprint's
// width/height swap) its top-left has to shift by this offset to keep the
// *visible*, rotated box's top-left lined up with the component's actual
// grid anchor (col, row). Works out to (0, 0) for any square (w === h)
// footprint -- i.e. every component except the laser today -- so this only
// actually does anything for non-square footprints.
function getRotationOffset(type, rotation) {
  const base = getDefaultFootprint(type);
  if (rotation !== 90 && rotation !== 270) return { x: 0, y: 0 };
  return {
    x: (base.h - base.w) * GRID_SIZE / 2,
    y: (base.w - base.h) * GRID_SIZE / 2,
  };
}

// A mousedown/mouseup pair on a placed component counts as a "click" (select
// it) rather than a drag as long as the cursor never moved more than this
// far in between -- keeps a slightly-shaky click from being misread as an
// intent to move the component.
const CLICK_MOVE_THRESHOLD = 4; // px

// Rotate button: sits just off the selected component's cell, offset by this
// gap -- same idea as the Stern-Gerlach sim's field-overlay anchoring.
const ROTATE_BUTTON_GAP = 8; // px
const ROTATE_BUTTON_SIZE = 26; // px

// Clockwise rotate glyph (Feather icons' "rotate-cw"): a ~270° arc plus a
// short hooked line at its open end that reads as the arrowhead.
function RotateIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#8b0000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
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
  // Whether the mouse has moved past CLICK_MOVE_THRESHOLD since the current
  // drag started -- distinguishes "clicked to select" from "dragged to move"
  // on mouseup, since both start the same way (mousedown on the component).
  const dragStartClientRef = useRef({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);

  const setDragPosBoth = (pos) => {
    dragPosRef.current = pos;
    setDragPos(pos);
  };

  // Which placed component (by id) is currently selected -- shows the blue
  // cell highlight (same as a drag target) and the rotate button. Only one
  // at a time. Left as-is (not cleared) while build/remove mode is active --
  // selection just goes inert (see selectionActive/selectedComp below) so
  // the rotate button can't float over whatever's being placed/removed, and
  // picks back up right where it was once that mode is left again.
  const [selectedId, setSelectedId] = useState(null);

  // Remove-mode drag-erase is tracked in a ref (not state) since it doesn't
  // need to trigger a re-render by itself -- only the resulting setComponents does.
  const removingRef = useRef(false);

  const cols = Math.max(1, Math.floor(canvasDims.width / GRID_SIZE));
  const rows = Math.max(1, Math.floor(canvasDims.height / GRID_SIZE));

  // Inert (no highlight, no button) while build/remove mode is active or a
  // drag is in progress -- even for a drag of the selected component itself,
  // so the button doesn't have to chase its free-following drag position.
  // It reappears once that mode/drag ends, right where it was.
  const selectionActive = !buildMode && draggingId == null;
  const selectedComp = selectionActive && selectedId != null
    ? components.find((c) => c.id === selectedId)
    : null;

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

    // {col, row, w, h}, in grid cells -- covers a multi-cell component's
    // whole footprint, not just one square of it.
    let highlightRect = null;
    let highlightKind = null; // 'place' | 'remove' | 'drag' | 'select'
    if (draggingId != null && dragPos) {
      // Same snap math as the drag's own mouseup handler, so the highlight
      // always matches where the component will actually land.
      const dragged = components.find((c) => c.id === draggingId);
      const ft = dragged ? getRotatedFootprint(getComponentType(dragged.type), dragged.rotation) : { w: 1, h: 1 };
      highlightRect = {
        col: clamp(Math.round(dragPos.x / GRID_SIZE), 0, cols - ft.w),
        row: clamp(Math.round(dragPos.y / GRID_SIZE), 0, rows - ft.h),
        w: ft.w,
        h: ft.h,
      };
      highlightKind = 'drag';
    } else if (hoveredCell && buildMode?.place) {
      const ft = getRotatedFootprint(getComponentType(buildMode.place), 0);
      highlightRect = { col: hoveredCell.col, row: hoveredCell.row, w: ft.w, h: ft.h };
      highlightKind = 'place';
    } else if (hoveredCell && buildMode === 'remove') {
      highlightRect = { col: hoveredCell.col, row: hoveredCell.row, w: 1, h: 1 };
      highlightKind = 'remove';
    } else if (selectedComp) {
      // Selection uses this same cell highlight (rather than a glow on the
      // component itself) so there's no flash-of-blue-then-red as a click
      // transitions from "maybe a drag" (which shows this highlight too)
      // into "just a selection" once mouseup confirms it never moved.
      const ft = getRotatedFootprint(getComponentType(selectedComp.type), selectedComp.rotation);
      highlightRect = { col: selectedComp.col, row: selectedComp.row, w: ft.w, h: ft.h };
      highlightKind = 'select';
    }

    if (highlightRect) {
      let fill;
      if (highlightKind === 'select') {
        fill = 'rgba(52, 152, 219, 0.25)';
      } else {
        // isFootprintFree also catches a footprint that doesn't fit on the
        // grid at all (e.g. a 2-wide laser hovered over the last column) --
        // that reads the same as "occupied" here, both meaning "can't go
        // here." Excludes the dragged component's own id -- its own cells
        // shouldn't read as "occupied" just because it's the thing being moved.
        const free = isFootprintFree(components, highlightRect.col, highlightRect.row, highlightRect.w, highlightRect.h, draggingId, cols, rows);
        if (highlightKind === 'remove') {
          fill = !free ? 'rgba(231, 76, 60, 0.35)' : 'rgba(231, 76, 60, 0.12)';
        } else {
          fill = free ? 'rgba(52, 152, 219, 0.25)' : 'rgba(231, 76, 60, 0.25)';
        }
      }
      ctx.fillStyle = fill;
      ctx.fillRect(highlightRect.col * GRID_SIZE, highlightRect.row * GRID_SIZE, highlightRect.w * GRID_SIZE, highlightRect.h * GRID_SIZE);
    }
  }, [components, canvasDims, displayBools, buildMode, hoveredCell, draggingId, dragPos, cols, rows, selectedComp]);

  const eraseAtClientPos = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cell = cellFromPoint(clientX - rect.left, clientY - rect.top, cols, rows);
    if (!cell) return;
    // Erases whichever component's footprint contains this cell -- a
    // multi-cell component (e.g. the laser) is removed by clicking any of
    // its cells, not just its anchor.
    setComponents((prev) => prev.filter((c) => {
      const ft = getRotatedFootprint(getComponentType(c.type), c.rotation);
      return !footprintsOverlap(cell.col, cell.row, 1, 1, c.col, c.row, ft.w, ft.h);
    }));
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
    if (buildMode?.place) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const cell = cellFromPoint(e.clientX - rect.left, e.clientY - rect.top, cols, rows);
      if (!cell) return;
      const type = getComponentType(buildMode.place);
      const ft = getRotatedFootprint(type, 0); // freshly placed, always starts unrotated
      if (!isFootprintFree(components, cell.col, cell.row, ft.w, ft.h, null, cols, rows)) return;
      setComponents((prev) => [...prev, { id: makeComponentId(), type: buildMode.place, col: cell.col, row: cell.row, rotation: 0 }]);
      setBuildMode(null); // single-shot placement, same as the Stern-Gerlach sim's build mode
      setSelectedId(null); // a fresh placement always starts deselected, not whatever was selected before
      return;
    }
    // A click that lands on empty canvas (not on a component -- see
    // handleComponentMouseDown, which never lets this fire for those)
    // deselects, same as clicking a selected component a second time.
    if (!buildMode) setSelectedId(null);
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
  // A release that never moved past CLICK_MOVE_THRESHOLD is treated as a
  // plain click instead -- see the mouseup handler below.
  const startDrag = (e, comp) => {
    if (buildMode) return; // don't fight with placement/remove mode
    e.stopPropagation();
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    dragOffsetRef.current = {
      x: (e.clientX - rect.left) - comp.col * GRID_SIZE,
      y: (e.clientY - rect.top) - comp.row * GRID_SIZE,
    };
    dragStartClientRef.current = { x: e.clientX, y: e.clientY };
    dragMovedRef.current = false;
    setDraggingId(comp.id);
    setDragPosBoth({ x: comp.col * GRID_SIZE, y: comp.row * GRID_SIZE });
  };

  useEffect(() => {
    if (draggingId == null) return;

    const onMove = (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dx = e.clientX - dragStartClientRef.current.x;
      const dy = e.clientY - dragStartClientRef.current.y;
      if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) dragMovedRef.current = true;
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
        setComponents((prev) => {
          const dragged = prev.find((c) => c.id === draggingId);
          if (!dragged) return prev;
          const ft = getRotatedFootprint(getComponentType(dragged.type), dragged.rotation);
          const col = clamp(Math.round(pos.x / GRID_SIZE), 0, cols - ft.w);
          const row = clamp(Math.round(pos.y / GRID_SIZE), 0, rows - ft.h);
          const free = isFootprintFree(prev, col, row, ft.w, ft.h, draggingId, cols, rows);
          return prev.map((c) => (c.id === draggingId && free ? { ...c, col, row } : c));
        });
      }
      if (dragMovedRef.current) {
        // An actual drag -- the component just moved becomes the selected
        // one, replacing whatever was selected before (if anything).
        setSelectedId(draggingId);
      } else {
        // Never actually dragged -- this was a click. Toggle selection instead
        // (the same component again deselects it, a different one switches to it).
        setSelectedId((prev) => (prev === draggingId ? null : draggingId));
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

  // Rotates the selected component 90° clockwise, staying anchored at its
  // current (col, row) -- so for a non-square footprint (the laser) this
  // can swing the far end into another component, or off the edge of the
  // grid, in a way that was perfectly fine before the rotation. Silently
  // refuses (component stays exactly as it was) rather than allowing that.
  // WPs/PBSs are visually (and eventually optically) identical at 0°/180°,
  // but the rotation state itself still just cycles through all four --
  // no special-casing needed here.
  const rotateSelected = () => {
    setComponents((prev) => {
      const comp = prev.find((c) => c.id === selectedId);
      if (!comp || !canRotateComponent(prev, comp, cols, rows)) return prev;
      return prev.map((c) => (c.id === selectedId ? { ...c, rotation: (c.rotation + 90) % 360 } : c));
    });
  };

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
        const base = getDefaultFootprint(type);
        const offset = getRotationOffset(type, comp.rotation);
        const isDragging = comp.id === draggingId;
        const anchorX = isDragging && dragPos ? dragPos.x : comp.col * GRID_SIZE;
        const anchorY = isDragging && dragPos ? dragPos.y : comp.row * GRID_SIZE;
        return (
          <img
            key={comp.id}
            src={type.image}
            alt={type.label}
            className={`placed-component ${isDragging ? 'dragging' : ''} ${buildMode === 'remove' ? 'remove-mode' : ''}`}
            style={{
              left: anchorX + offset.x,
              top: anchorY + offset.y,
              width: base.w * GRID_SIZE,
              height: base.h * GRID_SIZE,
              transform: `rotate(${comp.rotation}deg)`,
            }}
            draggable="false"
            onMouseDown={(e) => handleComponentMouseDown(e, comp)}
          />
        );
      })}
      {selectedComp && (() => {
        const ft = getRotatedFootprint(getComponentType(selectedComp.type), selectedComp.rotation);
        const growUp = selectedComp.row > 0;
        const cx = selectedComp.col * GRID_SIZE + (ft.w * GRID_SIZE) / 2;
        const cy = growUp
          ? selectedComp.row * GRID_SIZE - ROTATE_BUTTON_GAP
          : (selectedComp.row + ft.h) * GRID_SIZE + ROTATE_BUTTON_GAP;
        const canRotate = canRotateComponent(components, selectedComp, cols, rows);
        // Sits on the far side of the button from the component -- another
        // ROTATE_BUTTON_SIZE + ROTATE_BUTTON_GAP further out along the same
        // axis and anchor direction the button itself already uses.
        const messageY = growUp
          ? cy - ROTATE_BUTTON_SIZE - ROTATE_BUTTON_GAP
          : cy + ROTATE_BUTTON_SIZE + ROTATE_BUTTON_GAP;
        return (
          <>
            <button
              type="button"
              className="rotate-button"
              aria-label={canRotate ? 'Rotate component 90°' : 'Rotate component 90° -- blocked, another component is in the way.'}
              disabled={!canRotate}
              style={{
                left: cx,
                top: cy,
                width: ROTATE_BUTTON_SIZE,
                height: ROTATE_BUTTON_SIZE,
                transform: growUp ? 'translate(-50%, -100%)' : 'translate(-50%, 0%)',
              }}
              onClick={(e) => { e.stopPropagation(); rotateSelected(); }}
            >
              <RotateIcon />
            </button>
            {!canRotate && (
              <div
                className="rotate-blocked-message"
                style={{
                  left: cx,
                  top: messageY,
                  transform: growUp ? 'translate(-50%, -100%)' : 'translate(-50%, 0%)',
                }}
              >
                Another component is in the way, preventing this one from being rotated.
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}