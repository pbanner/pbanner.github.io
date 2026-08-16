import { useState, useEffect, useRef } from 'react';
import './App.css';
import LabPanel, { GRID_SIZE, CLICK_MOVE_THRESHOLD } from './LabPanel.jsx';
import { BuildPanel, DataCollectionPanel, DataPlottingPanel } from './panels.jsx';
import { COMPONENT_TYPES, getDefaultFootprint, getPlacementMessage } from './componentTypes.js';

// Gap between the placement ghost's own bottom edge and the guidance
// message below it.
const PLACEMENT_MESSAGE_GAP = 8;
// Gap between a hovered sidebar icon's own right edge and its floating
// label (see hoveredSidebarButton below).
const SIDEBAR_LABEL_GAP = 12;

export default function App() {
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,             // Displaying the grid
  });

  const [components, setComponents] = useState([]);

  // null = normal mode. { place: <componentId> } while a component from the
  // Build panel is armed and waiting to be dropped on the canvas. 'remove'
  // while the Remove Components tool is active.
  const [buildMode, setBuildMode] = useState(null);
  // Where the placement ghost is currently drawn, in viewport (client) coords.
  const [ghostPos, setGhostPos] = useState(null);

  const [dcMode, setDcMode] = useState({ mode: 'single', running: false });
  // Imperative handle onto LabPanel's own particle animation -- see
  // LabPanel's useImperativeHandle(spawnParticle, resetParticles). Data
  // collection (spawning/resetting photons) is driven from here rather than
  // from inside LabPanel itself, since the Data Collection panel that
  // triggers it is a sibling, not a child, of LabPanel.
  const labPanelRef = useRef(null);
  const [chartDisplayBools, setChartDisplayBools] = useState({
    showPercentages: 2,    // 0 = counts only, 1 = percentages only, 2 = both
    showErrorBars: false,
    showLegend: true,
    showTotal: true,
    showTheory: false,
  });

  // Which detector (by id) is currently hovered, shared between LabPanel and
  // the Histogram so hovering either one highlights the other -- lifted up
  // here rather than owned by either, since it's the one piece of state both
  // of those siblings need to read and write.
  const [hoveredDetectorId, setHoveredDetectorId] = useState(null);

  // Which sidebar icon (if any) is currently hovered -- { label, rect } for
  // the button's own DOMRect, or null. Drives the bold label that floats
  // outside the (thin) sidebar next to whichever icon it names; see the
  // render block below and BuildPanel's own onHoverButton.
  const [hoveredSidebarButton, setHoveredSidebarButton] = useState(null);

  // A mousedown on a sidebar add-icon starts a gesture that isn't yet
  // committed to being a click or a drag -- exactly the same distinction
  // LabPanel's own startDrag makes for moving an already-placed component,
  // just replayed here for *placing* a new one, so the two feel symmetric:
  // release without crossing CLICK_MOVE_THRESHOLD and it's click-to-place
  // (arm, then wait for a second click on the canvas -- unchanged from
  // before); cross it and it's a real drag, committed the moment the mouse
  // is released whether or not that release ever passes back over the icon
  // itself. Either way the component gets armed (buildMode/ghostPos) as
  // soon as the mouse goes down, since click-to-place already showed the
  // ghost immediately too -- there'd be nothing to distinguish a drag *from*
  // otherwise until it was too late to show the ghost following it from
  // the start.
  const buildDragRef = useRef(null);
  const handleBuildButtonMouseDown = (componentId, e) => {
    const wasAlreadyArmed = buildMode?.place === componentId;
    buildDragRef.current = { componentId, startX: e.clientX, startY: e.clientY, moved: false, wasAlreadyArmed };
    if (!wasAlreadyArmed) {
      setBuildMode({ place: componentId });
      setGhostPos({ x: e.clientX, y: e.clientY });
    }

    const onMove = (ev) => {
      const d = buildDragRef.current;
      if (!d || d.moved) return;
      if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) > CLICK_MOVE_THRESHOLD) d.moved = true;
    };
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const d = buildDragRef.current;
      buildDragRef.current = null;
      if (!d) return;
      if (d.moved) {
        // A real drag -- commit (or, dropped somewhere invalid, silently
        // cancel) right here, rather than waiting for a second click.
        // Dropped directly on the trash can specifically skips placing at
        // all, rather than placing a brand new component invisibly
        // underneath that (opaque, on-top) sidebar icon.
        const droppedOnTrash = !!document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-role="trash-target"]');
        if (!droppedOnTrash) labPanelRef.current?.placeComponentAt(d.componentId, ev.clientX, ev.clientY);
        setBuildMode(null);
      } else if (d.wasAlreadyArmed) {
        // A plain click on an already-armed icon -- toggle it back off,
        // same as before.
        setBuildMode(null);
      }
      // Otherwise: a plain click on a not-yet-armed icon -- stay armed,
      // waiting for a second click on the canvas (handled by LabPanel's
      // own handleCanvasClick).
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const toggleRemoveMode = () => {
    setBuildMode((prev) => (prev === 'remove' ? null : 'remove'));
  };

  // The ghost has to track the cursor across the whole screen -- including
  // while it's over the overlay panels, which sit visually on top of the
  // canvas -- so this listens at the window level rather than on the canvas
  // itself.
  useEffect(() => {
    if (!buildMode?.place) return;
    const onMove = (e) => setGhostPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [buildMode]);

  // Escape backs out of placement/remove mode, same as the Stern-Gerlach sim.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setBuildMode((prev) => (prev === null ? prev : null));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  // Ctrl/Cmd+G toggles the grid -- not exposed as a student-facing control,
  // just a quick way to hide the grid lines for clean screenshots. preventDefault
  // since browsers often bind this to "find next".
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setDisplayBools((prev) => ({ ...prev, gridOn: !prev.gridOn }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Continuous mode's spawn timer -- fires at the placed laser's own Laser
  // Power (photons/sec; see LabPanel's Laser Power control, which is where
  // that field actually lives). Keyed on laserPower rather than the whole
  // components array so dragging/rotating/placing unrelated components
  // doesn't restart -- and thereby reset the phase of -- an already-running
  // timer.
  const laserPower = components.find((c) => c.type === 'laser')?.power;
  useEffect(() => {
    if (dcMode.mode !== 'stream' || !dcMode.running) return;
    if (!laserPower || laserPower <= 0) return;
    const intervalMs = 1000 / laserPower;
    const id = setInterval(() => { labPanelRef.current?.spawnParticle(); }, intervalMs);
    return () => clearInterval(id);
  }, [dcMode.mode, dcMode.running, laserPower]);

  const handleMakeOnePhoton = () => {
    labPanelRef.current?.deselectAll();
    labPanelRef.current?.spawnParticle();
  };

  const handleToggleRunning = () => {
    if (!dcMode.running) labPanelRef.current?.deselectAll(); // about to start running -- clear the selection
    setDcMode((prev) => ({ ...prev, running: !prev.running }));
  };

  // Clears every in-flight photon, every detector's running count, and
  // stops continuous mode -- LabPanel owns the first (its own particlesRef,
  // via the ref above), this component owns the second (component state).
  const handleResetData = () => {
    labPanelRef.current?.resetParticles();
    setComponents((prev) => prev.map((c) => (c.type === 'detector' ? { ...c, count: 0 } : c)));
    setDcMode((prev) => ({ ...prev, running: false }));
  };

  // Edits the placed laser's own power from the Data Collection panel's
  // Laser Power slider (Continuous mode only) -- a no-op if there isn't one
  // yet (the slider is disabled in that case, but this stays a safe no-op
  // regardless of how it's triggered).
  const handleChangeLaserPower = (newPower) => {
    setComponents((prev) => prev.map((c) => (c.type === 'laser' ? { ...c, power: newPower } : c)));
  };

  // Auto-resets the histogram (running counts + any in-flight photons)
  // whenever the experiment itself changes -- placing/removing/moving/
  // rotating a component, or adjusting a wave plate's angle or a laser's
  // power. Keyed on a signature that leaves each detector's own count out,
  // so a detector actually being hit (which also goes through
  // setComponents, many times a second while photons are flowing) doesn't
  // retrigger this -- only a change to the experiment's own layout/settings
  // does. Skips its very first run (mount), since there's nothing to reset yet.
  const experimentSignature = JSON.stringify(components.map((c) => {
    const stripped = { ...c };
    delete stripped.count;
    return stripped;
  }));
  const isFirstExperimentSignature = useRef(true);
  useEffect(() => {
    if (isFirstExperimentSignature.current) {
      isFirstExperimentSignature.current = false;
      return;
    }
    labPanelRef.current?.resetParticles();
    setComponents((prev) => prev.map((c) => (c.type === 'detector' ? { ...c, count: 0 } : c)));
  }, [experimentSignature]);

  const armedType = buildMode?.place ? COMPONENT_TYPES.find((c) => c.id === buildMode.place) : null;

  // Detector<->histogram cross-highlighting is only meant to apply outside
  // build/remove mode -- reading it through this rather than the raw state
  // means a hover that was already active right as a build button gets
  // clicked (without the mouse itself moving off the detector) still goes
  // inert immediately, with no separate effect needed to clear it.
  const effectiveHoveredDetectorId = buildMode ? null : hoveredDetectorId;

  return (
    <div className="app-layout">
      {/* Main Canvas Area -- now fills the whole screen; the overlay panels
          float on top of it rather than pushing it into a side column. */}
      <div className="canvas-area">
        <LabPanel
          ref={labPanelRef}
          displayBools={displayBools}
          buildMode={buildMode}
          setBuildMode={setBuildMode}
          components={components}
          setComponents={setComponents}
          hoveredDetectorId={effectiveHoveredDetectorId}
          setHoveredDetectorId={setHoveredDetectorId}
        />
      </div>

      {/* Left-edge sidebar -- a thin single column of icon buttons (see
          BuildPanel/SidebarIconButton), an overlay in its own right rather
          than a member of the right-edge stack below, so it can eventually
          move again (e.g. Data Collection down to the lower-left) without
          disturbing that stack's own layout. */}
      <BuildPanel
        buildMode={buildMode}
        onButtonMouseDown={handleBuildButtonMouseDown}
        toggleRemoveMode={toggleRemoveMode}
        components={components}
        onHoverButton={setHoveredSidebarButton}
      />

      {/* A hovered sidebar icon's own bold label -- floats outside the
          (thin) sidebar itself, vertically centered on the icon it names.
          Plain viewport (fixed) coordinates, same reasoning as the
          placement ghost/message below: it has to render above everything,
          including the canvas and every other overlay panel. */}
      {hoveredSidebarButton && (
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

      {/* Two overlay panels, sharing the bottom-right corner of the screen
          side by side (Data Collection Controls to the left of the
          histogram) -- same floating-card look as the Stern-Gerlach sim's
          on-canvas field controls. Both bottom-aligned; see
          .overlay-panel-stack itself for how the row keeps Data Collection
          Controls flush against the histogram's own left edge regardless
          of that panel's width (it changes when Chart Options collapses). */}
      <div className="overlay-panel-stack">
        <div className="overlay-controls data-collection-panel">
          <DataCollectionPanel
            dcMode={dcMode}
            setDcMode={setDcMode}
            onMakeOnePhoton={handleMakeOnePhoton}
            onToggleRunning={handleToggleRunning}
            onResetData={handleResetData}
            laserPower={laserPower}
            onChangeLaserPower={handleChangeLaserPower}
          />
        </div>
        <DataPlottingPanel
          chartDisplayBools={chartDisplayBools}
          setChartDisplayBools={setChartDisplayBools}
          components={components}
          hoverEnabled={!buildMode}
          hoveredDetectorId={effectiveHoveredDetectorId}
          setHoveredDetectorId={setHoveredDetectorId}
        />
      </div>

      {/* Placement ghost: a half-opacity, full-scale preview of the armed
          component that follows the cursor everywhere, including over the
          overlay panels, until it's dropped on an empty grid square. */}
      {armedType && ghostPos && (() => {
        const footprint = getDefaultFootprint(armedType); // always unrotated -- a fresh placement starts at rotation 0
        const ghostHeight = footprint.h * GRID_SIZE;
        return (
          <>
            <img
              src={armedType.image}
              alt=""
              className="placement-ghost"
              style={{ left: ghostPos.x, top: ghostPos.y, width: footprint.w * GRID_SIZE, height: ghostHeight }}
              draggable="false"
            />
            <div
              className="placement-message"
              style={{ left: ghostPos.x, top: ghostPos.y + ghostHeight / 2 + PLACEMENT_MESSAGE_GAP }}
            >
              {getPlacementMessage(armedType)}
            </div>
          </>
        );
      })()}
    </div>
  );
}
