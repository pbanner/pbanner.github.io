import { useState, useEffect } from 'react';
import './App.css';
import LabPanel, { GRID_SIZE } from './LabPanel.jsx';
import { BuildPanel, DataCollectionPanel, DataPlottingPanel } from './panels.jsx';
import { COMPONENT_TYPES } from './componentTypes.js';

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

  const [dcMode, setDcMode] = useState({ mode: 'single', running: false, rate: 20 });
  const [chartDisplayBools, setChartDisplayBools] = useState({
    showPercentages: 2,    // 0 = counts only, 1 = percentages only, 2 = both
    showErrorBars: false,
    showLegend: true,
    showTotal: true,
    showTheory: false,
  });

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

  const armedType = buildMode?.place ? COMPONENT_TYPES.find((c) => c.id === buildMode.place) : null;

  return (
    <div className="app-layout">
      {/* Main Canvas Area -- now fills the whole screen; the overlay panels
          float on top of it rather than pushing it into a side column. */}
      <div className="canvas-area">
        <LabPanel
          displayBools={displayBools}
          buildMode={buildMode}
          setBuildMode={setBuildMode}
          components={components}
          setComponents={setComponents}
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
          />
        </div>
        <div className="overlay-controls data-collection-panel">
          <DataCollectionPanel dcMode={dcMode} setDcMode={setDcMode} />
        </div>
        <div className="overlay-controls data-plotting-panel">
          <DataPlottingPanel chartDisplayBools={chartDisplayBools} setChartDisplayBools={setChartDisplayBools} />
        </div>
      </div>

      {/* Placement ghost: a half-opacity, full-scale preview of the armed
          component that follows the cursor everywhere, including over the
          overlay panels, until it's dropped on an empty grid square. */}
      {armedType && ghostPos && (
        <img
          src={armedType.image}
          alt=""
          className="placement-ghost"
          style={{ left: ghostPos.x, top: ghostPos.y, width: GRID_SIZE, height: GRID_SIZE }}
          draggable="false"
        />
      )}
    </div>
  );
}
