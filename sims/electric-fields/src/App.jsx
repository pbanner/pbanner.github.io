import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import Viewer from './Viewer.jsx';
import ChargeSidebar from './ChargeSidebar.jsx';
import ChargeIcon from './ChargeIcon.jsx';
import DisplayOptionsPanel from './DisplayOptionsPanel.jsx';
import PropertiesPanel, { CutPanel, ProbePanel } from './PropertiesPanel.jsx';
import FieldProbesPanel from './FieldProbesPanel.jsx';
import CutInset from './CutInset.jsx';
import OrbitLock from './OrbitLock.jsx';
import { getChargeType, makeCharge, normalizePosition, crowds, freeingChanges, PINNING_CHANGES, isFree, freeLabelText } from './chargeTypes.js';
import { simulateRun, motionKey } from './motion.js';
import { contactGap, touchesFreeCharge, wallName } from './walls.js';
import { PROBE_TYPE, MAX_PROBES, isProbeId, nextProbeLabel, probeInCut } from './probes.js';
import { allowedCuts, defaultCutAxis, placeCut, keepInCut } from './cutPlanes.js';
import { CLICK_MOVE_THRESHOLD } from './sceneConstants.js';
import './App.css';

// Gap between a hovered sidebar icon's right edge and its floating label.
const SIDEBAR_LABEL_GAP = 12;
// Size of the 2D placement ghost.
const GHOST_ICON_SIZE = 36;

export default function App() {
  // Everything placed -- point charges and charged spheres, rods and
  // planes -- each { id, kind, position, ... } (see chargeTypes.js).
  // Called "charges" throughout: a charged sphere is a charge too, just a
  // spread-out one.
  const [charges, setCharges] = useState([]);
  const nextChargeIdRef = useRef(1);

  // The field probes, each { id, label, position, ... } (see probes.js). They're
  // placed and moved like point charges, but kept apart from the charges:
  // they read the field without adding to it.
  const [probes, setProbes] = useState([]);
  const nextProbeIdRef = useRef(1);

  // The charge selected for editing in the properties panel -- or 'cut',
  // the 2D cut, or a probe's id -- or null. Clicking a charge (or starting to drag a point
  // charge) selects it; a newly placed one is selected right away, so the
  // panel shows what can be changed.
  const [selectedId, setSelectedId] = useState(null);

  // The 2D cut, if there is one: { axis, offset } (see cutPlanes.js). Its
  // orientation is the user's choice; so is its offset, but only while the
  // charges allow it anywhere along its axis -- otherwise it's wherever the
  // charges pin it (placeCut), and the stored offset is kept in step with
  // that, so the cut stays put if they stop pinning it.
  const [cut, setCut] = useState(null);
  const allowed = useMemo(() => allowedCuts(charges), [charges]);
  const placedCut = cut && placeCut(cut, allowed);
  if (cut && placedCut.offset !== cut.offset) setCut({ ...cut, offset: placedCut.offset });
  // A new cut takes the first allowed orientation (cutPlanes.js), at the
  // charges' one allowed position, or in the middle of the box.
  const cutAt = (axis) => ({ axis, offset: allowed[axis].kind === 'one' ? allowed[axis].offset : 0 });
  const insertCut = () => {
    const axis = defaultCutAxis(allowed);
    if (axis === null) return;
    disarm();
    setRemoveMode(false);
    setCut(cutAt(axis));
    setSelectedId('cut');
  };
  const removeCut = () => {
    setCut(null);
    setSelectedId((prev) => (prev === 'cut' ? null : prev));
  };
  const moveCut = (offset) => {
    if (placedCut?.movable) setCut({ ...cut, offset });
  };

  // Whether the cut is shown in 2D (Viewer turns the camera to face it).
  // Only a valid cut can be; if it ever stops being valid, the view goes
  // back to 3D.
  const [view2D, setView2D] = useState(false);
  if (view2D && !placedCut?.valid) setView2D(false);
  // A probe off the cut is hidden in its view, so it's deselected too.
  const viewCut = () => {
    if (!placedCut?.valid) return;
    setOrbiting(false); // its button is disabled while orbiting; this is just to be sure
    disarm();
    setRemoveMode(false);
    const hiddenProbe = (id) => probes.some((p) => p.id === id && !probeInCut(p, placedCut));
    setSelectedId((prev) => (prev === 'cut' || hiddenProbe(prev) ? null : prev));
    setView2D(true);
  };

  // The charge type armed for placement (from a sidebar click, or during a
  // drag out of the sidebar) -- or PROBE_TYPE's id, for a probe -- or null.
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
    fieldDensity: 3, // 30 lines per unit charge (seedDirections.js), or 7 x 7 x 7 arrows (fieldArrows.js)
  });

  const viewerRef = useRef(null);

  // Whether the camera is orbiting (Start Orbit, in the view controls; see
  // CameraAnimator's startOrbit). It goes on until Stop Orbit, or any press
  // on the view (Viewer's onStopOrbit); meanwhile every other control is
  // disabled (OrbitLock.jsx), though scrolling still zooms. Only in 3D:
  // in the 2D cut's view the camera doesn't rotate. Starting it puts
  // down whatever the sidebar had armed, and leaves delete mode, so that
  // the press that stops it doesn't also place or delete something.
  const [orbiting, setOrbiting] = useState(false);
  const startOrbit = () => {
    disarm();
    setRemoveMode(false);
    setOrbiting(true);
  };

  // While the cut is viewed in 2D, everything placed or edited is kept
  // mirror-symmetric through it (keepInCut), so the cut stays valid: new
  // charges land in the cut, a new rod crosses it at right angles, a new
  // plane is perpendicular to it, and edits can't move anything out of it.
  const inCut = view2D && placedCut ? placedCut : null;
  // What the sidebar's type `typeId` would place at `point`: a charge, or
  // a probe, { kind: 'probe', position } (a placement in the cut is already
  // in it).
  const isProbeType = (typeId) => typeId === PROBE_TYPE.id;
  const makeNew = (typeId, point) => (isProbeType(typeId)
    ? { kind: 'probe', position: point }
    : makeCharge(typeId, point, inCut ? (c) => keepInCut(c, inCut, true) : undefined));
  // Where a new charge can't go: on top of a point charge or a thin rod
  // (crowds, in chargeTypes.js), or against a free charge -- a free charge
  // never touches anything (walls.js). Treated like a point off the grid
  // -- the ghost isn't drawn there, and dropping there places nothing. A
  // probe can go anywhere (on a charge, it reads "undefined"), up to
  // MAX_PROBES.
  const placeable = (typeId, point) => {
    if (!point) return false;
    if (isProbeType(typeId)) return probes.length < MAX_PROBES;
    const candidate = makeNew(typeId, point);
    return !crowds(candidate, charges) && !touchesFreeCharge(candidate, charges);
  };
  const addCharge = (typeId, position) => {
    if (!placeable(typeId, position)) return;
    if (isProbeType(typeId)) {
      const id = `probe-${nextProbeIdRef.current++}`;
      setProbes((prev) => [...prev, { id, label: nextProbeLabel(prev), position, showComponents: false, showFieldLine: false, showContributions: false }]);
      setSelectedId(id);
      return;
    }
    const id = nextChargeIdRef.current++;
    setCharges((prev) => [...prev, { id, ...makeNew(typeId, position) }]);
    setSelectedId(id);
  };
  // Every edit -- dragging, a handle, the properties panel -- goes through
  // here. One that would stack it on another charge, or put a free charge
  // against anything (walls.js) -- whichever of the two moves or grows --
  // is ignored, so a dragged charge stops at the last spot it can be, and
  // a typed position or size that it can't have springs back.
  const updateCharge = (id, changes) => {
    setCharges((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const changed = inCut ? keepInCut({ ...c, ...changes }, inCut) : { ...c, ...changes };
      if (!changed) return c;
      const next = normalizePosition(changed);
      const others = prev.filter((o) => o.id !== id);
      return crowds(next, others) || touchesFreeCharge(next, others) ? c : next;
    }));
  };
  const moveCharge = (id, position) => updateCharge(id, { position });
  // Switching a point charge between pinned and free, in its properties
  // panel: a newly free one gets the next free name (q₁, q₂, ...) and,
  // the first time, the default mass and no velocity (chargeTypes.js).
  const setFree = (id, free) => {
    const charge = charges.find((c) => c.id === id);
    if (charge) updateCharge(id, free ? freeingChanges(charge, charges) : PINNING_CHANGES);
  };
  const updateProbe = (id, changes) => setProbes((prev) => prev.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  const moveProbe = (id, position) => updateProbe(id, { position });
  const deleteProbe = (id) => {
    setProbes((prev) => prev.filter((p) => p.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  };
  const deleteCharge = (id) => {
    if (id === 'cut') {
      removeCut();
      return;
    }
    if (isProbeId(id)) {
      deleteProbe(id);
      return;
    }
    setCharges((prev) => prev.filter((c) => c.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  };

  const disarm = () => {
    setArmedTypeId(null);
    setGhostPoint(null);
  };

  // Recomputes both ghosts for a pointer position. `modifiers` is the
  // event's { shiftKey, altKey }: Shift raises or lowers a lifted ghost,
  // Alt skips grid snapping. `typeId` is the armed type (passed in when
  // it's only just been armed, before the state has caught up).
  const updateGhost = (clientX, clientY, modifiers, typeId = armedTypeId) => {
    lastPointerRef.current = { x: clientX, y: clientY };
    setGhostPos({ x: clientX, y: clientY });
    const point = viewerRef.current?.placementAt(clientX, clientY, modifiers) ?? null;
    setGhostPoint(typeId && placeable(typeId, point) ? point : null);
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
      updateGhost(e.clientX, e.clientY, e, typeId);
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
  //
  // The listeners call updateGhost through an effect event, so they always
  // see the current charges (for where the ghost can't go) without being
  // re-added every time anything changes.
  const ghostAt = useEffectEvent((clientX, clientY, modifiers) => updateGhost(clientX, clientY, modifiers));
  useEffect(() => {
    if (!armedTypeId) return;
    const onMove = (e) => ghostAt(e.clientX, e.clientY, e);
    const onKey = (e) => {
      const last = lastPointerRef.current;
      if (!last || (e.key !== 'Shift' && e.key !== 'Alt')) return;
      if (e.type === 'keydown' && e.key === 'Shift' && !e.repeat) viewerRef.current?.liftPlacement();
      ghostAt(last.x, last.y, e);
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
    setSelectedId(null);
    setRemoveMode((prev) => !prev);
  };

  // Escape backs out of placement or delete mode, same as the optics lab,
  // and deselects -- except while orbiting, when it's disabled like the
  // other controls. (Through an effect event, to see the current
  // `orbiting` without re-adding the listener.)
  const isOrbiting = useEffectEvent(() => orbiting);
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !isOrbiting()) {
        disarm();
        setRemoveMode(false);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The run the free charges would make from where they are now (motion.js),
  // for their predicted paths -- worked out only while one of those is
  // shown, and again only when something it depends on changes (its key):
  // as a free charge is dragged, say, but not when a display option is
  // checked. It takes a few milliseconds, so it keeps up with a drag.
  const showsPredictedPath = charges.some((c) => isFree(c) && c.showPredictedPath);
  const runKey = showsPredictedPath ? motionKey(charges) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key stands for the charges
  const predictedRun = useMemo(() => (runKey ? simulateRun(charges) : null), [runKey]);

  const armedType = !armedTypeId ? null : isProbeType(armedTypeId) ? PROBE_TYPE : getChargeType(armedTypeId);
  const selectedCharge = charges.find((c) => c.id === selectedId) ?? null;
  const selectedProbe = probes.find((p) => p.id === selectedId) ?? null;
  // What keeps the selected pinned point charge from being made free, if
  // anything: whatever it's touching (walls.js). Its panel's Free button is
  // grayed out then.
  const freeBlocker = selectedCharge?.kind === 'point' && !isFree(selectedCharge)
    ? charges.find((o) => o.id !== selectedCharge.id && contactGap(selectedCharge.position, o) <= 0) ?? null
    : null;
  // In the 2D cut's view, only the probes in the cut are shown, in the
  // scene and in the Field Probes panel.
  const shownProbes = inCut ? probes.filter((p) => probeInCut(p, inCut)) : probes;

  return (
    <div className="app-layout">
      <Viewer
        ref={viewerRef}
        charges={charges}
        probes={probes}
        onMoveProbe={moveProbe}
        onDeleteProbe={deleteProbe}
        ghost={armedTypeId && ghostPoint ? makeNew(armedTypeId, ghostPoint) : null}
        armedTypeId={armedTypeId}
        onPlaceClick={handlePlaceClick}
        removeMode={removeMode}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMoveCharge={moveCharge}
        onUpdateCharge={updateCharge}
        onDeleteCharge={deleteCharge}
        cut={placedCut}
        onMoveCut={moveCut}
        view2D={view2D}
        showGrid={displayOptions.showGrid}
        showAxes={displayOptions.showAxes}
        showField={displayOptions.showField}
        fieldStyle={displayOptions.fieldStyle}
        fieldDensity={displayOptions.fieldDensity}
        predictedRun={predictedRun}
        orbiting={orbiting}
        onStopOrbit={() => setOrbiting(false)}
      />

      <ChargeSidebar
        armedTypeId={armedTypeId}
        onButtonPointerDown={handleSidebarPointerDown}
        removeMode={removeMode}
        onToggleRemoveMode={toggleRemoveMode}
        onHoverButton={setHoveredSidebarButton}
        locked={orbiting}
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

      {/* Upper-right corner: the selected thing's panel, and under it the
          Field Probes panel -- or that alone, flush in the corner. */}
      <div className="upper-right-stack">
        <OrbitLock locked={orbiting}>
          {selectedId === 'cut' && placedCut && (
            <CutPanel
              cut={placedCut}
              allowed={allowed}
              onChangeAxis={(axis) => setCut(cutAt(axis))}
              onChangeOffset={moveCut}
              onView={viewCut}
              onRemove={removeCut}
              onClose={() => setSelectedId(null)}
            />
          )}

          {selectedCharge && (
            <PropertiesPanel
              charge={selectedCharge}
              lockedAxis={inCut ? inCut.axis : null}
              onChange={(changes) => updateCharge(selectedCharge.id, changes)}
              onSetFree={(free) => setFree(selectedCharge.id, free)}
              canBeFree={!freeBlocker}
              freeBlockedReason={freeBlocker && `A free charge can't start out touching anything, and this one touches ${wallName(freeBlocker, (c) => freeLabelText(c.freeLabel))}`}
              onDelete={() => deleteCharge(selectedCharge.id)}
              onClose={() => setSelectedId(null)}
            />
          )}

          {selectedProbe && (
            <ProbePanel
              probe={selectedProbe}
              lockedAxis={inCut ? inCut.axis : null}
              onChange={(changes) => updateProbe(selectedProbe.id, changes)}
              onDelete={() => deleteProbe(selectedProbe.id)}
              onClose={() => setSelectedId(null)}
            />
          )}

          {shownProbes.length > 0 && (
            <FieldProbesPanel probes={shownProbes} charges={charges} selectedId={selectedId} onSelect={setSelectedId} cut={inCut} />
          )}
        </OrbitLock>
      </div>

      {/* Lower-left corner: the view controls, under the axis gizmo (which
          Viewer draws in the canvas) -- or in 2D, under a small 3D picture
          of where the cut is. The cut's button inserts a cut, views it in
          2D, or goes back to 3D. The orbit's button starts and stops the
          orbit; while it runs, the other two are disabled. */}
      <div className="view-controls">
        {view2D && placedCut && <CutInset charges={charges} cut={placedCut} onClick={() => setView2D(false)} />}
        {view2D ? (
          <button className="control-button view-button" onClick={() => setView2D(false)}>
            Back to 3D
          </button>
        ) : placedCut ? (
          <button
            className="control-button view-button"
            disabled={!placedCut.valid || orbiting}
            title={placedCut.valid ? undefined : "The charges aren't all in the cut"}
            onClick={viewCut}
          >
            View 2D cut
          </button>
        ) : (
          <button
            className="control-button view-button"
            disabled={defaultCutAxis(allowed) === null || orbiting}
            title={defaultCutAxis(allowed) === null ? "The charges aren't all in one plane parallel to xy, xz or yz" : undefined}
            onClick={insertCut}
          >
            Insert 2D cut
          </button>
        )}
        <button
          className="control-button view-button"
          disabled={view2D}
          title={view2D ? 'The camera orbits only in 3D' : undefined}
          onClick={orbiting ? () => setOrbiting(false) : startOrbit}
        >
          {orbiting ? 'Stop Orbit' : 'Start Orbit'}
        </button>
        <button className="control-button view-button" disabled={orbiting} onClick={() => viewerRef.current?.resetView()}>
          Reset View
        </button>
      </div>

      {/* Lower-right corner: the Display Options panel. */}
      <div className="lower-right-stack">
        <OrbitLock locked={orbiting}>
          <DisplayOptionsPanel
            displayOptions={displayOptions}
            setDisplayOptions={setDisplayOptions}
            gridPlane={view2D && placedCut ? ['yz', 'xz', 'xy'][placedCut.axis] : 'xy'}
          />
        </OrbitLock>
      </div>

      {/* How to place and manipulate charges, shown at all times --
          nothing else on screen hints that Shift and Alt do anything. */}
      <div className="interaction-hint">
        {orbiting
          ? 'Orbiting the camera · Scroll to zoom · Click the view, or Stop Orbit, to stop'
          : removeMode
          ? 'Click an object to delete it · Press Escape, or click the trash can again, to stop deleting'
          : view2D
            ? 'Viewing the 2D cut! · Add objects from the sidebar · Click an object to edit it · Drag an object to move it · Drag empty space to pan, scroll to zoom · Back to 3D in the lower left'
            : 'Add objects from the sidebar · Click an object to edit it · Drag an object to change its position, Shift+drag to raise or lower, Alt+drag to turn off snapping'}
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
