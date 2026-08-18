import { useState, useEffect, useRef } from 'react';
import './App.css';
import LabPanel, { GRID_SIZE, CLICK_MOVE_THRESHOLD } from './LabPanel.jsx';
import { BuildPanel, DataCollectionPanel, DataPlottingPanel } from './panels.jsx';
import { SweepSpecModal, SweepResultsPanel } from './SweepPanel.jsx';
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
    // theoryScreenshotToggle = 0 is normal mode; 1 = show probabilities; 2 = show question marks
    // Activate 1 via Shift+P, 2 via Shift+Q -- same scheme as the Stern-Gerlach sim
    theoryScreenshotToggle: 0,
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

  // Tracks whether this tab is the active one, so both particle production
  // (continuous mode's spawn timer below) and the animation itself (inside
  // LabPanel) can pause together while it's hidden, rather than each
  // drifting out of sync based on whatever throttling the browser happens
  // to apply to timers vs. rAF callbacks in background tabs -- same
  // reasoning, and same pattern, as the Stern-Gerlach sim's own tabVisible.
  const [tabVisible, setTabVisible] = useState(!document.hidden);
  useEffect(() => {
    const onVisibilityChange = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);
  const [chartDisplayBools, setChartDisplayBools] = useState({
    showPercentages: 2,    // 0 = counts only, 1 = percentages only, 2 = both
    showErrorBars: false,
    showLegend: true,
    showTotal: true,
    showTheory: false,
  });

  // Parameter sweep -- null outside sweep mode entirely (one at a time, see
  // LabPanel's own sweepActive). phase is 'specifying' (the spec modal is
  // up), 'running', or 'done'. componentId is whichever wave plate the
  // sweep is for; values/shotsPerPoint are fixed once a sweep starts;
  // points grows live as LabPanel's runSweep reports each resolved point
  // back (see handleStartSweep below).
  const [sweepState, setSweepState] = useState(null);
  // Last-used spec-modal config (mode/start/stop/step/list/shots), kept
  // around purely to prefill the modal next time -- saves re-typing a range
  // a student is just widening or re-running with more shots.
  const [lastSweepConfig, setLastSweepConfig] = useState(null);
  // Flips true right before a run starts, false once it (naturally or via
  // Stop) finishes -- polled by runSweep's loop between steps, and by the
  // experimentSignature auto-reset effect below, which would otherwise
  // treat every one of the sweep's own angle steps as a fresh experiment
  // and wipe the very particles/counts the sweep just produced. A ref, not
  // state: nothing needs to re-render off it, it's only ever read inside
  // other effects/callbacks.
  const sweepCancelledRef = useRef(false);
  const sweepRunningRef = useRef(false);
  // True only for the duration of a single "take data at current settings"
  // burst (see handleTakeManualPoint) -- a full sweep run has its own
  // running phase (sweepState.phase), but a manual point is a one-off
  // outside that phase, so it needs its own flag to fold into sweepLocked
  // below and lock the canvas/build panel for its own burst.
  const [manualPointRunning, setManualPointRunning] = useState(false);

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

  // Shift+P toggles theoryScreenshotToggle -- swaps every placed detector
  // between its normal image+running-count display and a card showing its
  // exact theoretical hit probability (LabPanel does the actual drawing);
  // Shift+Q swaps to a card showing just a "?" instead, for a screenshot
  // that asks the question without giving away the answer. Ported from the
  // Stern-Gerlach sim's own Shift+P/Shift+Q, including the toggle-off-if-
  // already-active behavior.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.shiftKey) return;
      if (e.code === 'KeyP') {
        setDisplayBools((prev) => ({ ...prev, theoryScreenshotToggle: prev.theoryScreenshotToggle !== 1 ? 1 : 0 }));
      } else if (e.code === 'KeyQ') {
        setDisplayBools((prev) => ({ ...prev, theoryScreenshotToggle: prev.theoryScreenshotToggle !== 2 ? 2 : 0 }));
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
    if (dcMode.mode !== 'stream' || !dcMode.running || !tabVisible) return;
    if (!laserPower || laserPower <= 0) return;
    const intervalMs = 1000 / laserPower;
    const id = setInterval(() => { labPanelRef.current?.spawnParticle(); }, intervalMs);
    return () => clearInterval(id);
  }, [dcMode.mode, dcMode.running, laserPower, tabVisible]);

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
  // does. Skips its very first run (mount), since there's nothing to reset
  // yet, and every run while a sweep is active (sweepRunningRef) -- a
  // sweep's own angle steps go through this exact same signature, and
  // without the guard every one of them would read as "a new experiment"
  // and wipe the sweep's own in-flight burst and the live histogram's
  // counts right as they're produced.
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
    if (sweepRunningRef.current) return;
    labPanelRef.current?.resetParticles();
    setComponents((prev) => prev.map((c) => (c.type === 'detector' ? { ...c, count: 0 } : c)));
  }, [experimentSignature]);

  // WaveplateAngleControl's own "Sweep Angle..." button (see LabPanel's
  // selectedComp block) opens the spec modal for that component. Only one
  // sweep at a time -- there's no other entry point that could call this
  // while sweepState is already set (the button itself is hidden then).
  const handleOpenSweepModal = (componentId) => {
    labPanelRef.current?.deselectAll();
    setSweepState({ phase: 'specifying', componentId });
  };

  const handleCancelSweepSpec = () => setSweepState(null);

  // Confirming the spec modal: commits to the run. sweepRunningRef flips
  // true *before* runSweep is called (not inside it) so the very first
  // angle step's own setComponents can't race the experimentSignature
  // effect above. onPoint appends to sweepState.points as each one resolves
  // -- a functional update, since this closure's own `sweepState` would
  // otherwise go stale across the many points a long sweep reports back.
  const handleStartSweep = (config) => {
    const componentId = sweepState.componentId;
    setLastSweepConfig(config);
    setSweepState({ phase: 'running', componentId, values: config.values, shotsPerPoint: config.shots, points: [] });
    sweepCancelledRef.current = false;
    sweepRunningRef.current = true;
    labPanelRef.current?.runSweep({
      componentId,
      values: config.values,
      shotsPerPoint: config.shots,
      cancelledRef: sweepCancelledRef,
      onPoint: (point) => setSweepState((prev) => (prev ? { ...prev, points: [...prev.points, point] } : prev)),
    }).then(() => {
      sweepRunningRef.current = false;
      setSweepState((prev) => (prev ? { ...prev, phase: 'done' } : prev));
    });
  };

  // Stop just raises the flag runSweep's own loop polls between steps --
  // the transition to 'done' happens where handleStartSweep's own promise
  // resolves, not here, so both "ran to completion" and "stopped early"
  // land in the same place.
  const handleStopSweep = () => { sweepCancelledRef.current = true; };

  const handleBackFromSweep = () => setSweepState(null);

  // "Take data at current settings" -- appends one more point at whatever
  // the swept component's angle already is, without touching it. Only
  // reachable (see SweepResultsPanel) once a sweep is stopped/finished, so
  // there's no cancelledRef/running-state bookkeeping needed here.
  const handleTakeManualPoint = () => {
    if (!sweepState || manualPointRunning) return;
    const comp = components.find((c) => c.id === sweepState.componentId);
    if (!comp) return; // the swept component itself was deleted -- nothing left to read an angle from
    const value = comp.angle ?? 0;
    setManualPointRunning(true);
    labPanelRef.current?.runManualPoint({
      value,
      shotsPerPoint: sweepState.shotsPerPoint,
      onPoint: (point) => setSweepState((prev) => (prev ? { ...prev, points: [...prev.points, point] } : prev)),
    }).then(() => setManualPointRunning(false));
  };

  const sweepLocked = sweepState?.phase === 'running' || manualPointRunning;

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
          sweepState={sweepState}
          sweepLocked={sweepLocked}
          onOpenSweepModal={handleOpenSweepModal}
          tabVisible={tabVisible}
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
        locked={sweepLocked}
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
            locked={sweepLocked}
          />
        </div>
        {/* Once a sweep has started running (not just while its spec modal
            is up -- see sweepState.phase), its results panel takes this
            same slot instead of the usual histogram, all the way through
            the 'done' phase, until Back is pressed. Showing both at once
            would leave it ambiguous which "counts" a student is even
            looking at, since a sweep's own tallies never touch the
            detectors' live comp.count (see LabPanel's fireSweepBurst). */}
        {sweepState && sweepState.phase !== 'specifying' ? (
          <SweepResultsPanel
            sweepState={sweepState}
            components={components}
            onStop={handleStopSweep}
            onBack={handleBackFromSweep}
            onTakeManualPoint={handleTakeManualPoint}
            manualPointRunning={manualPointRunning}
          />
        ) : (
          <DataPlottingPanel
            chartDisplayBools={chartDisplayBools}
            setChartDisplayBools={setChartDisplayBools}
            components={components}
            hoverEnabled={!buildMode}
            hoveredDetectorId={effectiveHoveredDetectorId}
            setHoveredDetectorId={setHoveredDetectorId}
          />
        )}
      </div>

      {sweepState?.phase === 'specifying' && (
        <SweepSpecModal
          component={components.find((c) => c.id === sweepState.componentId)}
          initialConfig={lastSweepConfig}
          onCancel={handleCancelSweepSpec}
          onStart={handleStartSweep}
        />
      )}

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
