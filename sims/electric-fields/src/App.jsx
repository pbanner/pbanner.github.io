import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import Viewer from './Viewer.jsx';
import ChargeSidebar from './ChargeSidebar.jsx';
import ChargeIcon from './ChargeIcon.jsx';
import DisplayOptionsPanel from './DisplayOptionsPanel.jsx';
import PropertiesPanel, { CutPanel, ProbePanel } from './PropertiesPanel.jsx';
import FieldProbesPanel from './FieldProbesPanel.jsx';
import CutInset from './CutInset.jsx';
import OrbitLock from './OrbitLock.jsx';
import PlaybackPanel from './PlaybackPanel.jsx';
import { formatTime, FramePlayer } from './playback.js';
import { createFieldLineWorkers } from './fieldLineWorkers.js';
import { getChargeType, makeCharge, normalizePosition, crowds, freeingChanges, PINNING_CHANGES, isFree, freeLabelText } from './chargeTypes.js';
import { simulateRun, motionKey, stateAt, insideBox, MAX_RUN_TIME } from './motion.js';
import { contactGap, touchesFreeCharge, wallName } from './walls.js';
import { PROBE_TYPE, MAX_PROBES, isProbeId, nextProbeLabel, probeInCut } from './probes.js';
import { allowedCut, allowedCuts, defaultCutAxis, placeCut, keepInCut, allowsOffset } from './cutPlanes.js';
import { CLICK_MOVE_THRESHOLD } from './sceneConstants.js';
import './App.css';

// Gap between a hovered sidebar icon's right edge and its floating label.
const SIDEBAR_LABEL_GAP = 12;
// Size of the 2D placement ghost.
const GHOST_ICON_SIZE = 36;
const AXIS_NAMES = ['x', 'y', 'z'];

// What ended a run (motion.js's run.end), for the playback panel, naming
// free charges by name and anything else by what it is (walls.js).
function endNote(run, charges) {
  const name = (c) => freeLabelText(c.freeLabel);
  const at = `t = ${formatTime(run.end.time)}`;
  if (run.end.reason === 'collision') {
    const who = charges.find((c) => c.id === run.end.chargeId);
    const what = charges.find((c) => c.id === run.end.otherId);
    return `${name(who)} hit ${wallName(what, name)} at ${at}.`;
  }
  if (run.end.reason === 'left') return `Every free charge had left the box by ${at}.`;
  return `The run stopped at its ${MAX_RUN_TIME} s limit.`;
}

// Everything as it is at time t of a run: each free charge where the run
// has it, going as fast as it is then, and marked `outside` while it's out
// of the box (it isn't seen then, but its field still counts).
function chargesAt(charges, run, t) {
  const { positions, velocities } = stateAt(run, t);
  return charges.map((c) => {
    const i = run.ids.indexOf(c.id);
    return i < 0 ? c : { ...c, position: positions[i], velocity: velocities[i], outside: !insideBox(positions[i]) };
  });
}

// Which of `shown` make the field that's drawn (Display Options): all of
// them, the pinned ones, or all but the free charge feltBy.
function sourcesOf(shown, fieldOf, feltBy) {
  if (fieldOf === 'pinned') return shown.filter((c) => !isFree(c));
  if (fieldOf === 'felt') return shown.filter((c) => c.id !== feltBy);
  return shown;
}

// Whether the cut, where it was put (setupCut, from placeCut), is valid
// with everything as `shown` and the drawn field's `sources`: valid to
// begin with, and with both mirror-symmetric through it.
function cutValid(setupCut, shown, sources) {
  const at = (charges) => allowsOffset(allowedCut(charges, setupCut.axis), setupCut.offset);
  return setupCut.valid && at(shown) && (sources === shown || at(sources));
}

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

  // Playback of the free charges' motion (PlaybackPanel.jsx): status
  // 'setup' -- no run under way, and everything can be edited -- or
  // 'playing', 'paused' or 'ended' (the run has reached its end): a run is
  // under way (`running`), and nothing that would change it can be edited
  // until Reset. `time` is how far into the run, in seconds; `speed`, a
  // multiple of real time.
  const [playback, setPlayback] = useState({ status: 'setup', time: 0, speed: 1 });
  const running = playback.status !== 'setup';

  // The run (motion.js): the free charges' whole motion from where they
  // start, worked out whenever there are free charges -- for the playback
  // panel (how long the run is, and whether it can be played) and the
  // predicted paths -- and again only when something it depends on changes
  // (its key): as a free charge is dragged, say, but not when a display
  // option is checked. It takes a few milliseconds, so it keeps up with a
  // drag. Nothing that would change it can be edited during a run.
  const runKey = charges.some(isFree) ? motionKey(charges) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key stands for the charges
  const run = useMemo(() => (runKey ? simulateRun(charges) : null), [runKey]);

  // Everything as it is at this moment of the run: each free charge where
  // the run has it, going as fast as it is then, and marked `outside` while
  // it's out of the box (it isn't seen then, but its field still counts).
  // Before a run, the charges just as they're placed.
  const shownCharges = useMemo(() => {
    if (!running || !run) return charges;
    return chargesAt(charges, run, playback.time);
  }, [charges, run, running, playback.time]);

  // What the Display Options panel controls -- including which charges'
  // field is drawn (fieldOf): 'all' of them, the 'pinned' ones only, or
  // every one but one free charge, the field that free charge feels
  // ('felt', feltBy its id). Whatever is drawn, the probes read.
  const [displayOptions, setDisplayOptions] = useState({
    showGrid: true,
    showAxes: true,
    showField: true,
    fieldStyle: 'lines', // or 'arrows'
    fieldDensity: 3, // 30 lines per unit charge (seedDirections.js), or 7 x 7 x 7 arrows (fieldArrows.js)
    fieldOf: 'all', // or 'pinned' or 'felt'
    feltBy: null,
  });

  // The charges whose field is drawn (and read by the probes): as above,
  // at this moment of a run. With no free charges, all of them, whatever
  // the setting; and if the free charge chosen to feel the field is no
  // longer free, the first one that is.
  const freeCharges = charges.filter(isFree);
  const fieldOf = freeCharges.length === 0 ? 'all' : displayOptions.fieldOf;
  const feltBy = fieldOf === 'felt' ? (freeCharges.find((c) => c.id === displayOptions.feltBy) ?? freeCharges[0]).id : null;
  const fieldSources = useMemo(() => sourcesOf(shownCharges, fieldOf, feltBy), [shownCharges, fieldOf, feltBy]);

  // The 2D cut, if there is one: { axis, offset } (see cutPlanes.js). Its
  // orientation is the user's choice; so is its offset, but only while the
  // charges allow it anywhere along its axis -- otherwise it's wherever the
  // charges pin it (placeCut), and the stored offset is kept in step with
  // that, so the cut stays put if they stop pinning it.
  const [cut, setCut] = useState(null);
  const allowed = useMemo(() => allowedCuts(charges), [charges]);
  // During a run, the cut stays where it was put, but whether it's valid
  // follows the charges as they move: a free charge that leaves the cut
  // leaves the arrangement no longer mirror-symmetric through it.
  //
  // And the cut's lines are true field lines only if the field drawn is
  // mirror-symmetric through the cut too: with only some of the charges'
  // field drawn (Display Options), those charges alone have to be -- a
  // free charge mirroring a pinned one isn't, without the free one.
  const setupCut = cut && placeCut(cut, allowed);
  const placedCut = setupCut && { ...setupCut, valid: cutValid(setupCut, shownCharges, fieldSources) };
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
      // During a run, nothing that would change the run can change: only,
      // say, which of a free charge's marks are shown.
      if (running && motionKey([next]) !== motionKey([c])) return c;
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

  // Playing, pausing and so on (PlaybackPanel.jsx). Starting a run puts
  // down whatever the sidebar had armed, and leaves delete mode. Play once
  // the run is over plays it again from the start; scrubbing to a moment
  // pauses there (and starts a run, if there wasn't one under way).
  const play = () => {
    if (!run || run.end.time === 0) return;
    disarm();
    setRemoveMode(false);
    if (playback.time >= run.end.time) setSeeks((n) => n + 1);
    setPlayback((p) => ({ ...p, status: 'playing', time: p.time >= run.end.time ? 0 : p.time }));
  };
  const pause = () => setPlayback((p) => ({ ...p, status: 'paused' }));
  const resetRun = () => setPlayback((p) => ({ ...p, status: 'setup', time: 0 }));
  const scrub = (time) => {
    if (!run) return;
    disarm();
    setRemoveMode(false);
    setPlayback((p) => ({ ...p, status: time >= run.end.time ? 'ended' : 'paused', time }));
    setSeeks((n) => n + 1);
  };
  const setSpeed = (speed) => setPlayback((p) => ({ ...p, speed }));

  // Whether the field lines change as the run plays: while they're drawn,
  // and include a free charge's field. Then each moment's lines are traced
  // by workers, and the frame player (playback.js) shows a moment only once
  // its lines are ready, keeping lines and charges in step, at 30, 25 or
  // 20 frames a second, as fast as the workers manage. Otherwise -- arrows,
  // only the pinned charges' field, or no field -- nothing needs waiting
  // for, and playback simply follows the clock, every animation frame.
  //
  // The frames are for one set of settings, lineKey: a change to any of them
  // (or a scrub, or a new speed) starts the player over from the moment
  // shown. lineFrame is the frame shown; calculating, whether playback is
  // waiting for frames.
  const linesMove = running && displayOptions.showField && displayOptions.fieldStyle === 'lines' && fieldSources.some(isFree);
  const lineKey = linesMove ? JSON.stringify([runKey, fieldOf, feltBy, displayOptions.fieldDensity, view2D, setupCut?.axis ?? null, setupCut?.offset ?? null]) : null;
  const [lineFrame, setLineFrame] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [seeks, setSeeks] = useState(0); // counts scrubs and replays
  const playerRef = useRef(null);
  const workersRef = useRef(null);
  // The request for one moment's lines: everything as it is then, and the
  // cut's lines too if it's valid then.
  const lineRequest = useEffectEvent((time) => {
    const shown = chargesAt(charges, run, time);
    const sources = sourcesOf(shown, fieldOf, feltBy);
    const cutLines = setupCut && cutValid(setupCut, shown, sources) ? { axis: setupCut.axis, offset: setupCut.offset } : null;
    return workersRef.current.compute({ sources, density: displayOptions.fieldDensity, want3D: !view2D, cut: cutLines });
  });
  const playbackTime = useEffectEvent(() => playback.time);
  const isPlaying = useEffectEvent(() => playback.status === 'playing');
  useEffect(() => () => workersRef.current?.terminate(), []);
  useEffect(() => {
    if (!lineKey) return;
    if (!workersRef.current) workersRef.current = createFieldLineWorkers();
    if (!playerRef.current) {
      playerRef.current = new FramePlayer({
        workers: workersRef.current.count,
        inFlight: workersRef.current.capacity,
        now: () => performance.now(),
        compute: (time) => lineRequest(time),
        onCancel: () => workersRef.current.clearQueue(),
      });
    }
    playerRef.current.reset({ time: playbackTime(), end: run.end.time, speed: playback.speed, key: lineKey });
  }, [lineKey, playback.speed, seeks, run]);
  // With ?fps at the end of the address, a small readout of the frame
  // player's numbers, for checking it on a given computer: its workers, how
  // long a frame takes them (and from asking for it to getting it), the
  // rate it chose, and frames shown a second.
  const [showRates] = useState(() => new URLSearchParams(window.location.search).has('fps'));
  const [rates, setRates] = useState(null);
  useEffect(() => {
    if (!lineKey) return undefined;
    let frame;
    let shownTime = null;
    const shownAt = []; // when each recent frame was first shown
    let lastRates = 0;
    const loop = () => {
      const player = playerRef.current;
      const state = player.tick(isPlaying());
      setLineFrame(state.frame);
      setCalculating(state.calculating);
      const now = performance.now();
      if (state.time !== shownTime || (state.ended && isPlaying())) {
        if (state.time !== shownTime) shownAt.push(now);
        shownTime = state.time;
        setPlayback((p) => ({ ...p, time: state.time, status: p.status === 'playing' && state.ended ? 'ended' : p.status }));
      }
      if (showRates && now - lastRates > 500) {
        lastRates = now;
        while (shownAt.length > 0 && shownAt[0] < now - 1000) shownAt.shift();
        setRates({ workers: player.workers, ms: player.msPerFrame, trip: player.msPerTrip, fps: player.fps, shown: shownAt.length });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [lineKey, showRates]);

  // While playing, if the lines don't move: each animation frame, the time
  // is however far real time (times the speed) has gone since playing
  // began, until the run's end. (Through an effect event, to read the time
  // playing began at without restarting the clock on every tick.)
  useEffect(() => {
    if (playback.status !== 'playing' || !run || linesMove) return undefined;
    const startTime = playbackTime();
    const end = run.end.time;
    let startWall = null;
    let frame;
    const tick = (now) => {
      if (startWall === null) startWall = now;
      const time = Math.min(end, startTime + (playback.speed * (now - startWall)) / 1000);
      setPlayback((p) => ({ ...p, time, status: time >= end ? 'ended' : p.status }));
      if (time < end) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playback.status, playback.speed, run, linesMove]);

  // In the 2D cut's view, a run can be played only if it stays in the cut:
  // every free charge in it (it is, if the cut is valid) and moving within
  // it -- no part of its velocity across the cut. Otherwise, why not.
  // (Searched for in `charges` itself: searching freeCharges, an array made
  // from it, keeps the React Compiler from optimizing App -- it can't then
  // tell that nothing changes the charges after they're memoized from.)
  const acrossAxis = view2D && placedCut ? placedCut.axis : null;
  const movingAcross = acrossAxis === null ? null : charges.find((c) => isFree(c) && Math.abs(c.velocity[acrossAxis]) > 1e-9);
  const playBlockedReason = movingAcross
    ? `To play in the 2D cut, every free charge has to move within it, and ${freeLabelText(movingAcross.freeLabel)}'s velocity has a ${AXIS_NAMES[acrossAxis]} part`
    : null;

  // What ended the run, once it's been reached.
  const runNote = running && run && playback.time >= run.end.time ? endNote(run, charges) : null;

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
        charges={shownCharges}
        fieldSources={fieldSources}
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
        run={run}
        lineFrame={linesMove ? lineFrame : undefined}
        runTime={playback.time}
        runLocked={running}
        orbiting={orbiting}
        onStopOrbit={() => setOrbiting(false)}
      />

      <ChargeSidebar
        armedTypeId={armedTypeId}
        onButtonPointerDown={handleSidebarPointerDown}
        removeMode={removeMode}
        onToggleRemoveMode={toggleRemoveMode}
        onHoverButton={setHoveredSidebarButton}
        locked={orbiting || running}
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
              readOnly={running}
              onClose={() => setSelectedId(null)}
            />
          )}

          {selectedCharge && (
            <PropertiesPanel
              charge={shownCharges.find((c) => c.id === selectedId)}
              readOnly={running}
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
              readOnly={running}
              lockedAxis={inCut ? inCut.axis : null}
              onChange={(changes) => updateProbe(selectedProbe.id, changes)}
              onDelete={() => deleteProbe(selectedProbe.id)}
              onClose={() => setSelectedId(null)}
            />
          )}

          {shownProbes.length > 0 && (
            <FieldProbesPanel probes={shownProbes} charges={fieldSources} selectedId={selectedId} onSelect={setSelectedId} cut={inCut} />
          )}
        </OrbitLock>
      </div>

      {/* Lower-left corner: the view controls, under the axis gizmo (which
          Viewer draws in the canvas) -- or in 2D, under a small 3D picture
          of where the cut is. The cut's button inserts a cut, views it in
          2D, or goes back to 3D. The orbit's button starts and stops the
          orbit; while it runs, the other two are disabled. */}
      <div className="view-controls">
        {view2D && placedCut && <CutInset charges={shownCharges} cut={placedCut} onClick={() => setView2D(false)} />}
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
            disabled={defaultCutAxis(allowed) === null || orbiting || running}
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
            freeCharges={freeCharges}
            fieldOf={fieldOf}
            feltBy={feltBy}
            gridPlane={view2D && placedCut ? ['yz', 'xz', 'xy'][placedCut.axis] : 'xy'}
          />
        </OrbitLock>
      </div>

      {/* Bottom center: the playback controls, while there's a free charge,
          above how to place and manipulate charges, which is shown at all
          times -- nothing else on screen hints that Shift and Alt do
          anything. */}
      <div className="bottom-center-stack">
        {charges.some(isFree) && (
          <div className="playback-holder">
            <OrbitLock locked={orbiting}>
              <PlaybackPanel
                run={run}
                playback={playback}
                onPlay={play}
                onPause={pause}
                onReset={resetRun}
                onScrub={scrub}
                onSpeed={setSpeed}
                note={runNote}
                calculating={linesMove && calculating}
                playBlockedReason={playBlockedReason}
              />
            </OrbitLock>
          </div>
        )}
        <div className="interaction-hint">
          {orbiting
            ? 'Orbiting the camera · Scroll to zoom · Click the view, or Stop Orbit, to stop'
            : running
            ? `A run is under way · Click a charge to see where it is and how fast it's going · Drag empty space to ${view2D ? 'pan' : 'turn the view'} · Reset to edit again`
            : removeMode
            ? 'Click an object to delete it · Press Escape, or click the trash can again, to stop deleting'
            : view2D
              ? 'Viewing the 2D cut! · Add objects from the sidebar · Click an object to edit it · Drag an object to move it · Drag empty space to pan, scroll to zoom · Back to 3D in the lower left'
              : 'Add objects from the sidebar · Click an object to edit it · Drag an object to change its position, Shift+drag to raise or lower, Alt+drag to turn off snapping'}
        </div>
      </div>

      {showRates && (
        <div className="rates-readout">
          {linesMove && rates
            ? `Field lines: ${rates.workers} workers, ${rates.ms === null ? '…' : `${rates.ms.toFixed(0)} ms a frame (${rates.trip.toFixed(0)} ms there and back)`} · ${rates.fps} fps chosen, ${rates.shown} frames shown in the last second`
            : 'Field lines: not changing as the charges move, so nothing to work out ahead'}
        </div>
      )}

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
