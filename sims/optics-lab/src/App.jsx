import { useState, useEffect, useRef } from 'react';
import './App.css';
import LabPanel, { GRID_SIZE } from './LabPanel.jsx';
import { BuildPanel, DataCollectionPanel, DataPlottingPanel } from './panels.jsx';
import { COMPONENT_TYPES, getDefaultFootprint, getPlacementMessage } from './componentTypes.js';

// Gap between the placement ghost's own bottom edge and the guidance
// message below it.
const PLACEMENT_MESSAGE_GAP = 8;

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

  // Arms (or, clicking the same button again, disarms) a component for
  // placement. Seeded from the click event that triggered it so the ghost
  // appears immediately under the cursor, right over the Build panel, before
  // any further mouse movement.
  const armPlacement = (componentId, e) => {
    setBuildMode((prev) => (prev?.place === componentId ? null : { place: componentId }));
    if (e) setGhostPos({ x: e.clientX, y: e.clientY });
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
    labPanelRef.current?.spawnParticle();
  };

  const handleToggleRunning = () => {
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

      {/* Three overlay panels, stacked from the bottom of the screen along
          the right edge -- same floating-card look as the Stern-Gerlach
          sim's on-canvas field controls. The plotting panel gets a fixed
          height; the build panel grows to fill whatever's left above the
          (content-sized) data collection panel. */}
      <div className="overlay-panel-stack">
        <div className="overlay-controls build-panel">
          <BuildPanel
            buildMode={buildMode}
            armPlacement={armPlacement}
            toggleRemoveMode={toggleRemoveMode}
            components={components}
          />
        </div>
        <div className="overlay-controls data-collection-panel">
          <DataCollectionPanel
            dcMode={dcMode}
            setDcMode={setDcMode}
            onMakeOnePhoton={handleMakeOnePhoton}
            onToggleRunning={handleToggleRunning}
            onResetData={handleResetData}
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
