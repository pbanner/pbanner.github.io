import { useEffect, useRef, useState } from 'react';
import Viewer from './Viewer.jsx';
import ChargeSidebar from './ChargeSidebar.jsx';
import ChargeIcon from './ChargeIcon.jsx';
import DisplayOptionsPanel from './DisplayOptionsPanel.jsx';
import { getChargeType } from './chargeTypes.js';
import { CLICK_MOVE_THRESHOLD } from './sceneConstants.js';
import './App.css';

// Gap between a hovered sidebar icon's right edge and its floating label.
const SIDEBAR_LABEL_GAP = 12;
// Size of the 2D placement ghost.
const GHOST_ICON_SIZE = 36;

export default function App() {
  // Every placed charge: { id, type, position: [x, y, z] }.
  const [charges, setCharges] = useState([]);
  const nextChargeIdRef = useRef(1);

  // The charge type armed for placement (from a sidebar click, or during a
  // drag out of the sidebar), or null.
  const [armedTypeId, setArmedTypeId] = useState(null);
  // Where the pointer is while armed, in viewport (client) coordinates...
  const [ghostPos, setGhostPos] = useState(null);
  // ...and where in 3D that would place the charge (see Viewer's
  // placementAt), or null when it can't go there. Drives which ghost is
  // drawn: the 3D one in the scene when this is set, the flat 2D icon
  // otherwise.
  const [ghostPoint, setGhostPoint] = useState(null);
  // The last pointer position seen while armed, so pressing or releasing a
  // modifier key can recompute the ghost without waiting for the pointer
  // to move.
  const lastPointerRef = useRef(null);

  // Which sidebar icon (if any) is hovered -- { label, rect } -- for the
  // floating label next to it.
  const [hoveredSidebarButton, setHoveredSidebarButton] = useState(null);

  // The sidebar's delete tool: while on, clicking a charge deletes it.
  const [removeMode, setRemoveMode] = useState(false);

  // What the Display Options panel controls.
  const [displayOptions, setDisplayOptions] = useState({
    showGrid: true,
    showAxes: true,
    showField: true,
    fieldStyle: 'lines', // or 'arrows'
    fieldDensity: 3, // 26 lines per charge (SEED_SETS in fieldLines.js), or 7 x 7 x 7 arrows (fieldArrows.js)
  });

  const viewerRef = useRef(null);

  const addCharge = (typeId, position) => {
    const id = nextChargeIdRef.current++;
    setCharges((prev) => [...prev, { id, type: typeId, position }]);
  };
  const moveCharge = (id, position) => {
    setCharges((prev) => prev.map((c) => (c.id === id ? { ...c, position } : c)));
  };
  const deleteCharge = (id) => {
    setCharges((prev) => prev.filter((c) => c.id !== id));
  };

  const disarm = () => {
    setArmedTypeId(null);
    setGhostPoint(null);
  };

  // Recomputes both ghosts for a pointer position. `modifiers` is the
  // event's { shiftKey, altKey }: Shift raises or lowers a lifted ghost,
  // Alt skips grid snapping.
  const updateGhost = (clientX, clientY, modifiers) => {
    lastPointerRef.current = { x: clientX, y: clientY };
    setGhostPos({ x: clientX, y: clientY });
    setGhostPoint(viewerRef.current?.placementAt(clientX, clientY, modifiers) ?? null);
  };

  // A pointerdown on a sidebar charge starts a gesture that isn't yet
  // committed to being a click or a drag -- the same distinction the optics
  // lab makes (see its handleBuildButtonPointerDown). Release without
  // moving past CLICK_MOVE_THRESHOLD and it's click-to-place: the charge
  // stays armed, waiting for a click on the grid (Viewer's onPlaceClick).
  // Move past it and it's drag-to-place: the charge drops wherever the
  // pointer is released, or nowhere if that isn't over the grid.
  const buildDragRef = useRef(null);
  const handleSidebarPointerDown = (typeId, e) => {
    // Touch/pen pointers get implicit capture on the element they went
    // down on, which would keep every later pointermove targeted at the
    // sidebar button. Release it so hit-testing over the canvas works
    // during the drag (same fix as the optics lab).
    try { e.target.releasePointerCapture(e.pointerId); } catch { /* nothing was captured (e.g. a mouse pointer) */ }
    setRemoveMode(false); // arming a charge and deleting are mutually exclusive
    const wasAlreadyArmed = armedTypeId === typeId;
    buildDragRef.current = { typeId, startX: e.clientX, startY: e.clientY, moved: false, wasAlreadyArmed };
    if (!wasAlreadyArmed) {
      setArmedTypeId(typeId);
      viewerRef.current?.startPlacement();
      updateGhost(e.clientX, e.clientY, e);
    }

    const onMove = (ev) => {
      const d = buildDragRef.current;
      if (!d || d.moved) return;
      if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) > CLICK_MOVE_THRESHOLD) d.moved = true;
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = buildDragRef.current;
      buildDragRef.current = null;
      if (!d) return;
      if (d.moved) {
        const point = viewerRef.current?.placementAt(ev.clientX, ev.clientY, ev);
        if (point) addCharge(d.typeId, point);
        disarm();
      } else if (d.wasAlreadyArmed) {
        // A plain click on the already-armed icon toggles it back off.
        disarm();
      }
      // Otherwise: a plain click on a not-yet-armed icon -- stay armed.
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Click-to-place's second click, on the canvas. An invalid click (off
  // the grid) leaves the charge armed to try again, same as the optics lab.
  const handlePlaceClick = (clientX, clientY, modifiers) => {
    if (!armedTypeId) return;
    const point = viewerRef.current?.placementAt(clientX, clientY, modifiers);
    if (!point) return;
    addCharge(armedTypeId, point);
    disarm();
  };

  // While armed, the ghosts track the pointer across the whole window --
  // including over the overlay controls -- so this listens on window.
  //
  // Shift and Alt are watched on their own as well, so they take effect
  // without waiting for the pointer to move. A Shift *press* (not a held
  // Shift, and not the key's auto-repeat) is what lifts the ghost off the
  // floor; Viewer's liftPlacement ignores it unless the ghost has a floor
  // point to lift from.
  useEffect(() => {
    if (!armedTypeId) return;
    const onMove = (e) => updateGhost(e.clientX, e.clientY, e);
    const onKey = (e) => {
      const last = lastPointerRef.current;
      if (!last || (e.key !== 'Shift' && e.key !== 'Alt')) return;
      if (e.type === 'keydown' && e.key === 'Shift' && !e.repeat) viewerRef.current?.liftPlacement();
      updateGhost(last.x, last.y, e);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [armedTypeId]);

  const toggleRemoveMode = () => {
    disarm();
    setRemoveMode((prev) => !prev);
  };

  // Escape backs out of placement or delete mode, same as the optics lab.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        disarm();
        setRemoveMode(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const armedType = armedTypeId ? getChargeType(armedTypeId) : null;

  return (
    <div className="app-layout">
      <Viewer
        ref={viewerRef}
        charges={charges}
        ghost={armedTypeId && ghostPoint ? { type: armedTypeId, position: ghostPoint } : null}
        armedTypeId={armedTypeId}
        onPlaceClick={handlePlaceClick}
        removeMode={removeMode}
        onMoveCharge={moveCharge}
        onDeleteCharge={deleteCharge}
        showGrid={displayOptions.showGrid}
        showAxes={displayOptions.showAxes}
        showField={displayOptions.showField}
        fieldStyle={displayOptions.fieldStyle}
        fieldDensity={displayOptions.fieldDensity}
      />

      <ChargeSidebar
        armedTypeId={armedTypeId}
        onButtonPointerDown={handleSidebarPointerDown}
        removeMode={removeMode}
        onToggleRemoveMode={toggleRemoveMode}
        onHoverButton={setHoveredSidebarButton}
      />

      {hoveredSidebarButton && !armedTypeId && (
        <div
          className="sidebar-hover-label"
          style={{
            left: hoveredSidebarButton.rect.right + SIDEBAR_LABEL_GAP,
            top: hoveredSidebarButton.rect.top + hoveredSidebarButton.rect.height / 2,
          }}
        >
          {hoveredSidebarButton.label}
        </div>
      )}

      {/* Lower-right corner: Reset View stacked on top of the Display
          Options panel. */}
      <div className="lower-right-stack">
        <button className="control-button reset-view-button" onClick={() => viewerRef.current?.resetView()}>
          Reset View
        </button>
        <DisplayOptionsPanel displayOptions={displayOptions} setDisplayOptions={setDisplayOptions} />
      </div>

      {/* How to place and manipulate charges, shown at all times --
          nothing else on screen hints that Shift and Alt do anything. */}
      <div className="interaction-hint">
        {removeMode
          ? 'Click a charge to delete it. Esc to stop deleting.'
          : 'Drag a charge in from the sidebar · Drag a charge to move it · Shift+drag to raise or lower · Hold Alt to turn off snapping · Drag onto the trash to delete'}
      </div>

      {/* While armed: a flat 2D icon follows the pointer whenever the charge
          can't be placed there (over the sidebar, off the edge of the
          grid, ...). Otherwise the 3D ghost in the scene takes its place,
          sitting exactly where the charge would land. */}
      {armedType && ghostPos && !ghostPoint && (
        <div className="placement-ghost" style={{ left: ghostPos.x, top: ghostPos.y }}>
          <ChargeIcon type={armedType} size={GHOST_ICON_SIZE} />
        </div>
      )}
    </div>
  );
}
