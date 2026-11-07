import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls, GizmoHelper } from '@react-three/drei';
import { ChargeDrag } from './chargeDrag.js';
import ChargeMarker, { PositionGuides } from './ChargeMarker.jsx';
import ProbeMarker, { ProbeFieldLine } from './ProbeMarker.jsx';
import { probeReading, probeInCut } from './probes.js';
import { objectField, fieldKey } from './chargeField.js';
import { chargeColor, isFree, freeLabelText } from './chargeTypes.js';
import ChargedObject from './ChargedObject.jsx';
import ObjectHandles from './ObjectHandles.jsx';
import { VelocityArrow, PredictedPath } from './MotionMarks.jsx';
import CutPlane from './CutPlane.jsx';
import { objectHandles, LineDrag, unitAxis } from './handles.js';
import Axes from './Axes.jsx';
import { AxisGizmo, CameraAnimator } from './AxisGizmo.jsx';
import { axisViewOrientation, stopMomentum } from './cameraViews.js';
import FieldLines from './FieldLines.jsx';
import FieldArrows from './FieldArrows.jsx';
import { CoordinateReadoutPanel, CoordinateReadoutTracker } from './CoordinateReadout.jsx';
import { rayFromClient, intersectAxisPlane, pickCharge, pickObject, objectGuideSegments, snapValue, clampToWorld, SNAP_STEP } from './geometry.js';
import { WORLD_HALF_EXTENT, CHARGE_RADIUS, PROBE_PICK_RADIUS, INITIAL_CAMERA_POSITION, INITIAL_CAMERA_TARGET, CAMERA_FOV, CLICK_MOVE_THRESHOLD, VIEW_CONTROLS_GIZMO_MARGIN } from './sceneConstants.js';

// A directional light that rides along with the camera, so whatever side of
// the scene is facing the viewer is always the lit side -- same approach as
// the Bloch sphere sim's own CameraLight.
function CameraLight() {
  const lightRef = useRef();
  const { camera } = useThree();
  useFrame(() => {
    lightRef.current?.position.copy(camera.position);
  });
  return <directionalLight ref={lightRef} intensity={2.2} />;
}

// The z = 0 reference plane, drawn as a single light-gray grid with a line
// every SNAP_STEP, so every grid crossing is a point a charge can snap to.
// gridHelper takes (size, divisions, center-line color, line color); both
// colors are the same so the lines through the origin don't stand out
// either. It's built lying in three's default XZ plane, so it's rotated a
// quarter turn about x to lie in XY instead (our floor, since z is up).
// In the 2D cut's view, the same grid is drawn in the cut instead: across
// `axis` at `offset` (turned a quarter turn about z for a cut across x).
//
// The grid is drawn first (renderOrder -1) and doesn't write depth, so
// anything else at z = 0 -- the axes, a dragged charge's guides -- always
// draws over it instead of z-fighting with the grid lines it overlaps.
const GRID_COLOR = '#d3d7dc';
const GRID_ROTATIONS = [[0, 0, Math.PI / 2], [0, 0, 0], [Math.PI / 2, 0, 0]];
function Floor({ axis = 2, offset = 0 }) {
  const size = 2 * WORLD_HALF_EXTENT;
  const position = [0, 0, 0];
  position[axis] = offset;
  return (
    <gridHelper args={[size, Math.round(size / SNAP_STEP), GRID_COLOR, GRID_COLOR]} position={position} rotation={GRID_ROTATIONS[axis]} renderOrder={-1} material-depthWrite={false} />
  );
}

// The 2D cut's view: the camera looks straight at the cut with a field of
// view of FLAT_FOV degrees -- narrow enough that the perspective is
// practically flat -- from far enough back that FLAT_HEIGHT world units
// (the box, with a margin) fit on screen both ways. Getting there and back
// takes CUT_VIEW_DURATION seconds (see CameraAnimator's moveTo), during
// which the view can't be grabbed. In 2D, dragging with either button
// pans (there's no rotating), and scrolling zooms.
const FLAT_FOV = 3;
// Which mouse buttons and touches do what: OrbitControls' defaults in 3D;
// in 2D, panning instead of rotating.
const ORBIT_MOUSE_BUTTONS = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const PAN_MOUSE_BUTTONS = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const ORBIT_TOUCHES = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
const PAN_TOUCHES = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
const FLAT_HEIGHT = 12.5;
const CUT_VIEW_DURATION = 1.0;

// The coordinate readout while something's dragged (CoordinateReadout.jsx):
// { position, axes } -- the coordinates that can change, floating over
// where it was grabbed (`grab`, from the drag's start). A rod moves only
// across itself, so it shows the two coordinates across it, at the point
// along it where it was grabbed; a plane or the 2D cut moves only along
// its normal, so it shows that one coordinate, at the point grabbed.
function dragReadout(item, grab) {
  if (item.kind === 'rod') {
    const position = [...item.position];
    position[item.axis] = grab?.along ?? 0;
    return { position, axes: [0, 1, 2].filter((k) => k !== item.axis) };
  }
  if (item.kind === 'plane' || item.kind === 'cut') {
    const position = [...(grab?.point ?? [0, 0, 0])];
    position[item.axis] = item.kind === 'cut' ? item.offset : item.position[item.axis];
    return { position, axes: [item.axis] };
  }
  return { position: item.position };
}

// charges: everything placed, [{ id, kind, ... }] (see chargeField.js).
//   They're also the field's sources (`sources`, below), which are traced
//   again only when something the field depends on changes -- not for a
//   re-render for anything else (e.g. the hover highlight), nor for a
//   change to a free charge that doesn't touch the field (its velocity).
//   The placement ghost isn't a source: only placed charges make a field.
// probes: the field probes, [{ id, label, position }] (see probes.js),
//   picked and dragged like point charges (onMoveProbe(id, position),
//   onDeleteProbe(id)). In the 2D cut's view, only those in the cut are
//   shown.
// ghost: the charge -- or probe, { kind: 'probe', position } -- that click-
//   or drag-to-place would add (see chargeTypes.js's makeCharge), drawn as
//   a translucent preview, or null
// armedTypeId: the charge type waiting for click-to-place's second click
// onPlaceClick(clientX, clientY, modifiers): that second click, on the canvas
// removeMode: the sidebar's delete tool is on, so clicking a charge deletes it
// selectedId / onSelect(id or null): the charge selected for the properties
//   panel. Pressing on a charge selects it; clicking empty space deselects.
// onMoveCharge(id, position) / onUpdateCharge(id, changes) /
//   onDeleteCharge(id): edits to placed charges ('cut' for the 2D cut)
// cut: the 2D cut, where it is (cutPlanes.js's placeCut), or null. It's
//   selected as 'cut', and dragged along its axis (onMoveCut(offset)) when
//   the charges allow that.
// view2D: showing the cut in 2D: the camera turns to face it and flattens
//   its perspective, and only the cut's field lines (or arrows) are drawn.
// showGrid / showAxes / showField / fieldStyle ('lines' or 'arrows') /
//   fieldDensity: the Display Options panel's settings
// run: the free charges' run (motion.js's simulateRun), or null -- for
//   the predicted paths of the free charges that show theirs. Free charges
//   that show their velocity get an arrow along it.
// runTime / runLocked: during a run, how far into it (s), and that it's
//   under way. `charges` is then everything as it is at that moment (App's
//   shownCharges): a free charge marked `outside` is out of the box, and
//   isn't drawn or picked, though its field still counts. Nothing can be
//   moved, placed or deleted during a run; a click on something selects
//   it (to see its panel), and a drag anywhere turns the view.
// orbiting: the camera is orbiting (Start Orbit; see CameraAnimator's
//   startOrbit). Any press on the view stops it, where it is
//   (onStopOrbit()), and then does whatever it would have done anyway.
export default function Viewer({ ref, charges, probes, onMoveProbe, onDeleteProbe, ghost, armedTypeId, onPlaceClick, removeMode, selectedId, onSelect, onMoveCharge, onUpdateCharge, onDeleteCharge, cut, onMoveCut, view2D, showGrid, showAxes, showField, fieldStyle, fieldDensity, run, runLocked = false, orbiting, onStopOrbit }) {
  const wrapperRef = useRef();
  const controlsRef = useRef();
  const cameraAnimatorRef = useRef();
  // The latest left-button press: where it was, and what it landed on --
  // { target: 'armed' (click-to-place's second click), 'point', 'object'
  // (with its id) or 'empty', x, y }. See handlePointerDownCapture.
  const pressRef = useRef(null);
  // The ChargeDrag tracking the placement ghost while a charge is armed.
  const placementRef = useRef(null);

  // The charge or object under the pointer (a point charge is highlighted;
  // either sets the cursor), and the point charge being dragged, if any.
  const [hoveredId, setHoveredId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const dragRef = useRef(null);
  // Where the dragged rod, plane or cut was grabbed, for the readout (see
  // dragReadout): { along } for a rod, { point } for a plane or the cut.
  const [dragGrab, setDragGrab] = useState(null);
  const readoutPanelRef = useRef(null);


  // The camera facing the cut in 2D: from whichever side of it the camera
  // is on, turned from its current orientation by the smallest rotation
  // (as the axis gizmo turns it), centered on the middle of the cut.
  const flatFraming = (from) => {
    const camera = controlsRef.current.object;
    const side = camera.position.getComponent(cut.axis) >= cut.offset ? 1 : -1;
    const direction = [0, 1, 2].map((k) => (k === cut.axis ? side : 0));
    const target = new THREE.Vector3(...[0, 1, 2].map((k) => (k === cut.axis ? cut.offset : 0)));
    // In a window narrower than it is tall, the box's width is the tighter
    // fit: visible width = height x aspect ratio.
    const height = Math.max(FLAT_HEIGHT, FLAT_HEIGHT / camera.aspect);
    return { quaternion: axisViewOrientation(from.quaternion, direction).quaternion, target, fov: FLAT_FOV, height };
  };

  // Turning view2D on swings the camera round to face the cut, flattening
  // the perspective on the way; turning it off swings it back to where it
  // was in 3D (saved3DRef). Re-run if the cut moves while in 2D, to keep it
  // centered.
  const saved3DRef = useRef(null);
  const cutAxis = cut?.axis;
  const cutOffset = cut?.offset;
  useEffect(() => {
    const animator = cameraAnimatorRef.current;
    if (!animator || !controlsRef.current) return;
    if (view2D && cutAxis !== undefined) {
      const now = animator.state();
      if (!saved3DRef.current) saved3DRef.current = now;
      animator.moveTo(flatFraming(now), CUT_VIEW_DURATION, { lock: true });
    } else if (!view2D && saved3DRef.current) {
      animator.moveTo(saved3DRef.current, CUT_VIEW_DURATION, { lock: true });
      saved3DRef.current = null;
    }
    // flatFraming reads the current cut, whose position is in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view2D, cutAxis, cutOffset]);

  // The orbit follows the `orbiting` prop. (A press on the view also stops
  // it straight away, in handlePointerDownCapture, without waiting for the
  // prop to catch up: see there.)
  useEffect(() => {
    const animator = cameraAnimatorRef.current;
    if (orbiting) animator?.startOrbit();
    else animator?.stopOrbit();
  }, [orbiting]);

  // Can't use controls.reset(): drei captures the controls' saved state
  // before applying the `target` prop, so reset() would aim at the wrong
  // point (same issue the Bloch sphere sim works around). Set both
  // explicitly instead, after stopping any motion left over from a drag
  // (which would otherwise carry on turning the camera), and put back the
  // field of view (which an interrupted 2D transition could have left
  // narrower). In 2D, Reset View re-centers the cut instead.
  const resetView = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (view2D && cut) {
      const animator = cameraAnimatorRef.current;
      animator.moveTo(flatFraming(animator.state()), 0.35);
      return;
    }
    cameraAnimatorRef.current?.cancel(); // a gizmo move in progress would otherwise carry on from here
    stopMomentum(controls);
    controls.object.fov = CAMERA_FOV;
    controls.object.updateProjectionMatrix();
    controls.object.up.set(0, 0, 1); // a gizmo move may have left another axis up
    controls.object.position.set(...INITIAL_CAMERA_POSITION);
    controls.target.set(...INITIAL_CAMERA_TARGET);
    controls.update();
  };

  // The ray from the camera through a viewport point, or null if that
  // point isn't actually on the 3D canvas -- off the viewer entirely, or
  // over one of the overlay controls drawn on top of it. Checked with
  // elementFromPoint (what's really under the pointer) rather than the
  // canvas's bounding rect, since the rect alone can't see overlays.
  const rayAt = (clientX, clientY) => {
    const wrapper = wrapperRef.current;
    const controls = controlsRef.current;
    if (!wrapper || !controls) return null;
    const under = document.elementFromPoint(clientX, clientY);
    if (!(under instanceof HTMLCanvasElement) || !wrapper.contains(under)) return null;
    return rayFromClient(controls.object, under.getBoundingClientRect(), clientX, clientY);
  };

  // Placement goes through a ChargeDrag (see chargeDrag.js) so that, as
  // with moving a placed charge, Shift can raise or lower the ghost. App.jsx
  // drives it through the ref: startPlacement() when a charge is armed,
  // placementAt() on every pointer move (and on release, to place it), and
  // liftPlacement() when Shift is pressed.
  const startPlacement = () => {
    placementRef.current = new ChargeDrag(null, view2D ? cut : null);
  };

  // Where a new charge dropped at this viewport point would land, or null
  // if it can't go there (off the canvas, or off the floor grid before
  // it's been lifted). This is the one function that answers "where in 3D
  // does a 2D drop go?" -- App.jsx uses it both to position the 3D ghost
  // and to actually place the charge. `modifiers` is the event's
  // { shiftKey, altKey }.
  const placementAt = (clientX, clientY, modifiers) => {
    const ray = rayAt(clientX, clientY);
    const placement = placementRef.current;
    if (!placement) return null;
    if (!ray) {
      placement.pointerLeft();
      return null;
    }
    return placement.update({ ray, camera: controlsRef.current.object, shiftKey: modifiers.shiftKey, altKey: modifiers.altKey });
  };

  const liftPlacement = () => placementRef.current?.liftOff() ?? false;

  // resetView is exposed too, for the Reset View button, which App.jsx
  // renders under the axis gizmo.
  useImperativeHandle(ref, () => ({ startPlacement, placementAt, liftPlacement, resetView }));

  // The pointer's ray for a drag. Deliberately not rayAt(): a drag should
  // keep working even while the pointer passes over an overlay (e.g. on
  // its way to the trash).
  const rayFor = (ev) => rayFromClient(controlsRef.current.object, wrapperRef.current.getBoundingClientRect(), ev.clientX, ev.clientY);

  // Calls update(event) for every pointer move until the button's released,
  // then onRelease(event) -- and once straight away, with the press itself,
  // so the drag anchors there and the very first pixels of movement count.
  const followPointer = (downEvent, update, onRelease) => {
    const onUp = (ev) => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      onRelease(ev);
    };
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    update(downEvent);
  };
  // The end of a drag. Whatever was dragged onto the sidebar's trash can is
  // deleted (onDelete(id)).
  const endDrag = (ev, onDelete) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    setDragGrab(null);
    if (d && document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-role="trash-target"]')) onDelete(d.id);
  };

  // Moves a placed charge, following the same ChargeDrag rules as a
  // placement once it's been lifted: drag to slide it horizontally,
  // Shift+drag to raise or lower it -- or in the 2D cut's view, within
  // the cut. A probe moves the same way, with its own onMove and onDelete,
  // and so do a charged sphere and rod. A rod's position has no coordinate
  // along its own length (normalizePosition drops it), so it moves only
  // across itself: one along x slides along y, and with Shift, along z.
  const startDrag = (charge, downEvent, { onMove = onMoveCharge, onDelete = onDeleteCharge } = {}) => {
    const drag = new ChargeDrag(charge.position, view2D ? cut : null);
    dragRef.current = { id: charge.id, drag };
    setDraggingId(charge.id);
    if (charge.kind === 'rod') {
      const along = new LineDrag(charge.position, unitAxis(charge.axis), 0).along(rayFor(downEvent));
      setDragGrab({ along: along === null ? 0 : clampToWorld(along) });
    }
    followPointer(downEvent, (ev) => {
      if (!dragRef.current || !controlsRef.current) return;
      const before = drag.position;
      const after = drag.update({ ray: rayFor(ev), camera: controlsRef.current.object, shiftKey: ev.shiftKey, altKey: ev.altKey });
      if (after !== before) onMove(charge.id, after);
    }, (ev) => endDrag(ev, onDelete));
  };

  // Moves a charged plane, or the 2D cut, the one way it can go: along its
  // normal (with or without Shift). It's dragged along the normal through
  // the point grabbed, so that point follows the pointer (LineDrag); kept
  // in the box, and snapped to whole cm unless Alt is held. (Looking
  // straight along the normal, the pointer can't say how far along it it
  // means, and the plane stays put.)
  const startNormalDrag = (item, downEvent) => {
    const { axis } = item;
    const start = item.kind === 'cut' ? item.offset : item.position[axis];
    const hit = intersectAxisPlane(rayFor(downEvent), axis, start);
    const grab = hit ? hit.toArray() : unitAxis(axis).map((u) => (u ? start : 0));
    const drag = new LineDrag(grab, unitAxis(axis), start);
    dragRef.current = { id: item.id, drag };
    setDraggingId(item.id);
    setDragGrab({ point: grab });
    followPointer(downEvent, (ev) => {
      if (!dragRef.current) return;
      const value = clampToWorld(drag.update(rayFor(ev), ev.altKey));
      if (item.kind === 'cut') onMoveCut(value);
      else onUpdateCharge(item.id, { position: unitAxis(axis).map((u) => (u ? value : 0)) });
    }, (ev) => endDrag(ev, onDeleteCharge));
  };

  // The charges as the field's sources: the same array, but a new one only
  // when something the field depends on changes (chargeField.js's
  // fieldKey) -- not, say, a free charge's velocity, or whether its arrow
  // is shown -- so the field lines and arrows, which are traced again
  // whenever their sources change, aren't traced again for nothing. (So
  // the deps are the key, not the array: the array is read only when the
  // key changes.)
  const sourcesKey = fieldKey(charges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sources = useMemo(() => charges, [sourcesKey]);

  // Point charges are picked, dragged and drawn as ChargeMarkers; the
  // charged spheres, rods and planes ("objects") as ChargedObjects.
  const pointCharges = charges.filter((c) => c.kind === 'point' && !c.outside);
  const objects = charges.filter((c) => c.kind !== 'point');
  const shownProbes = view2D && cut ? probes.filter((p) => probeInCut(p, cut)) : probes;
  const probeHandlers = { onMove: onMoveProbe, onDelete: onDeleteProbe };

  // The 2D cut, as something to pick and give handles to, like an object.
  const cutObject = cut && { kind: 'cut', id: 'cut', ...cut };

  // What's under a viewport point, if anything: { charge, isPoint,
  // isProbe }. A probe wins over everything -- it's small, and often sits
  // right on or inside something charged -- a point charge over an object,
  // even one in front of it -- a charge inside a shell would otherwise be
  // impossible to reach -- and an object over the 2D cut, which crosses
  // the whole box. A probe is picked and dragged like a point charge.
  const pickAt = (clientX, clientY) => {
    const ray = rayAt(clientX, clientY);
    if (!ray) return null;
    const probe = pickCharge(ray, shownProbes, PROBE_PICK_RADIUS);
    if (probe) return { charge: probe, isPoint: true, isProbe: true };
    const point = pickCharge(ray, pointCharges, CHARGE_RADIUS);
    if (point) return { charge: point, isPoint: true };
    const obj = pickObject(ray, objects);
    if (obj) return { charge: obj, isPoint: false };
    // The cut is picked like a sheet at its position -- except in 2D,
    // where it isn't drawn (it's the whole view), so a click on empty space
    // deselects and the delete tool can't delete it.
    const cutPosition = cut && [0, 1, 2].map((k) => (k === cut.axis ? cut.offset : 0));
    if (cut && !view2D && pickObject(ray, [{ kind: 'plane', form: 'sheet', axis: cut.axis, position: cutPosition }])) {
      return { charge: cutObject, isPoint: false };
    }
    return null;
  };

  // The selected sphere, rod or slab, whose size handles (handles.js) are
  // shown -- except while placing something or deleting, and in the 2D
  // cut's view, any that would take it out of the cut (one moving across
  // the cut).
  const handleHidden = (h) => view2D && cut && Math.abs(h.direction[cut.axis]) > 1e-9;
  const selectedObject = armedTypeId || removeMode || runLocked ? null : objects.find((c) => c.id === selectedId) ?? null;
  // The handle under the pointer (handles.js's { id, position, ... }), and
  // the one being dragged, { id, label, value, position } -- if any. The
  // readout labels a hovered handle ("Radius"), and shows a dragged one's
  // label and value ("Radius = 3 cm"), floating above the handle.
  const [hoveredHandle, setHoveredHandle] = useState(null);
  const hoveredHandleId = hoveredHandle?.id ?? null;
  const [handleDrag, setHandleDrag] = useState(null);

  // The selected object's handle under a viewport point, if any. Handles
  // are drawn the same size on screen however far away they are, so
  // they're picked by on-screen distance: within HANDLE_HIT_PX of the
  // pointer, the closest one.
  const HANDLE_HIT_PX = 18;
  const pickHandle = (clientX, clientY) => {
    const controls = controlsRef.current;
    if (!selectedObject || !controls || !rayAt(clientX, clientY)) return null;
    const camera = controls.object;
    const rect = wrapperRef.current.getBoundingClientRect();
    let best = null;
    let bestDist = HANDLE_HIT_PX;
    for (const h of objectHandles(selectedObject, camera)) {
      if (h.disabled || handleHidden(h)) continue;
      const ndc = new THREE.Vector3(...h.position).project(camera);
      const x = rect.left + ((ndc.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - ndc.y) / 2) * rect.height;
      const dist = Math.hypot(x - clientX, y - clientY);
      if (dist < bestDist) {
        bestDist = dist;
        best = h;
      }
    }
    return best;
  };

  // Drags one of the selected object's size handles: a single value along
  // its line (LineDrag), kept within the box and at least MIN_SIZE.
  const MIN_SIZE = SNAP_STEP / 2;
  const startHandleDrag = (obj, handle, downEvent) => {
    const size = (v) => Math.min(2 * WORLD_HALF_EXTENT, Math.max(MIN_SIZE, v));
    // For each handle: where its line starts from and the value it drags,
    // how a new value changes the object, and the readout's label and
    // value.
    let drag;
    let apply;
    let label;
    let valueOf;
    if (handle.id === 'radius') {
      drag = new LineDrag(handle.position, handle.direction, obj.radius);
      apply = (v) => ({ radius: size(v) });
      [label, valueOf] = ['Radius', (o) => o.radius];
    } else {
      // Thickness: the face moves half as far as the thickness changes, so
      // the thickness is snapped rather than the face's position.
      drag = new LineDrag(handle.position, handle.direction, obj.thickness / 2, (v) => v);
      apply = (v, altKey) => ({ thickness: size(altKey ? 2 * v : snapValue(2 * v)) });
      [label, valueOf] = ['Thickness', (o) => o.thickness];
    }

    const update = (ev) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const ray = rayFromClient(controls.object, wrapperRef.current.getBoundingClientRect(), ev.clientX, ev.clientY);
      const changes = apply(drag.update(ray, ev.altKey), ev.altKey);
      onUpdateCharge(obj.id, changes);
      const moved = { ...obj, ...changes };
      const h = objectHandles(moved, controls.object).find((x) => x.id === handle.id);
      setHandleDrag({ id: handle.id, label, value: valueOf(moved), position: h.position });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setHandleDrag(null);
    };
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    update(downEvent);
  };

  // Runs in the *capture* phase -- on the way down from the outer page
  // to the canvas, before the event reaches OrbitControls, which listens
  // on an element inside this wrapper. That ordering is what lets one
  // left-drag mean two different things: on a charge, object or probe,
  // stopPropagation() here keeps OrbitControls from ever seeing the press,
  // so it's selected and moves, and the camera doesn't; on empty space it
  // passes through untouched and the camera orbits. (So does a press on
  // the 2D cut where the charges pin it in place: it can't move, and it's
  // only selected if the press turns out to be a click -- see
  // handlePointerUp.)
  //
  // The selected object's size handles come first: a press on one drags
  // it.
  //
  // While a charge is armed, this just records the press for
  // click-to-place's second click, which is likewise acted on at pointerup
  // only if the pointer barely moved -- so a real drag still orbits the
  // camera, and only a genuine click drops the charge.
  //
  // Any press -- any button, anywhere on the view, the axis gizmo included
  // -- first stops the orbit, if the camera is orbiting. It's stopped here
  // and now, not just through App.jsx's state (which only reaches the
  // orbit after a re-render), so the camera doesn't move a frame further
  // under a drag that's just starting from where it is.
  const handlePointerDownCapture = (e) => {
    if (orbiting) {
      cameraAnimatorRef.current?.stopOrbit();
      onStopOrbit();
    }
    pressRef.current = null;
    // Finish any typing in the properties panel first: taking the focus
    // away from its box commits what was typed to the charge it belongs
    // to, before this press can select a different one (which would
    // otherwise replace the box, typing and all).
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    if (e.button !== 0) return; // right-drag pans; leave it to OrbitControls
    const at = { x: e.clientX, y: e.clientY };
    if (armedTypeId) {
      pressRef.current = { target: 'armed', ...at };
      return;
    }
    const handle = pickHandle(e.clientX, e.clientY);
    if (handle) {
      pressRef.current = { target: 'handle', ...at };
      e.stopPropagation();
      startHandleDrag(selectedObject, handle, e);
      return;
    }
    const picked = pickAt(e.clientX, e.clientY);
    if (!picked) {
      pressRef.current = { target: 'empty', ...at };
      return;
    }
    const item = picked.charge;
    // During a run, a press on something only selects it, if it turns out
    // to be a click (handlePointerUp); a drag from it turns the view.
    if (runLocked) {
      pressRef.current = { target: 'object', id: item.id, ...at };
      return;
    }
    if (item.kind === 'cut' && !item.movable && !removeMode) {
      pressRef.current = { target: 'object', id: item.id, ...at };
      return;
    }
    pressRef.current = { target: 'grabbed', ...at };
    e.stopPropagation();
    if (removeMode) {
      (picked.isProbe ? onDeleteProbe : onDeleteCharge)(item.id);
      setHoveredId(null);
    } else {
      onSelect(item.id);
      if (picked.isProbe) startDrag(item, e, probeHandlers);
      else if (item.kind === 'plane' || item.kind === 'cut') startNormalDrag(item, e);
      else startDrag(item, e);
    }
  };

  // A click on empty space deselects. react-three-fiber calls this for a
  // click (a press and release without moving more than a couple of
  // pixels, so not an orbiting drag) that hit no 3D object with its own
  // click handler -- so clicking the axis gizmo's labels doesn't deselect.
  // Charges aren't such objects (they're picked with plain ray math, in
  // handlePointerDownCapture), so a click on one would count as missing
  // too, as would click-to-place's click; pressRef rules those out.
  const handlePointerMissed = () => {
    if (pressRef.current?.target === 'empty') onSelect(null);
  };

  const handlePointerMove = (e) => {
    if (dragRef.current || handleDrag || armedTypeId) return;
    const handle = pickHandle(e.clientX, e.clientY);
    if ((handle?.id ?? null) !== hoveredHandleId) setHoveredHandle(handle);
    const id = handle ? null : pickAt(e.clientX, e.clientY)?.charge.id ?? null;
    if (id !== hoveredId) setHoveredId(id);
  };

  // The object (or cut) being dragged, if any, for its guides.
  const draggedObject = draggingId == null ? null : objects.find((c) => c.id === draggingId) ?? (draggingId === 'cut' ? cutObject : null);

  // The readout: while a handle drags a single value, its name and value
  // ("Radius = 3 cm"), floating above the handle, and while the pointer is
  // over one, just its name; otherwise the coordinates of whatever's being
  // dragged (dragReadout), or else of the placement ghost.
  const HANDLE_LABELS = { radius: 'Radius', thickness: 'Thickness' };
  let readout = null;
  if (handleDrag) {
    readout = handleDrag;
  } else if (hoveredHandle && selectedObject) {
    readout = { position: hoveredHandle.position, label: HANDLE_LABELS[hoveredHandle.id] };
  } else if (draggingId != null) {
    const dragged = charges.find((c) => c.id === draggingId) ?? probes.find((p) => p.id === draggingId) ?? (draggingId === 'cut' ? cutObject : null);
    if (dragged) readout = dragReadout(dragged, dragGrab);
  } else if (ghost) {
    readout = { position: ghost.position };
  }

  // Over anything that can be dragged -- a charge, object, probe or handle
  // -- grab. Over the 2D cut where the charges pin it, or while deleting,
  // a pointing hand (it can be clicked).
  let cursor;
  if (draggingId != null || handleDrag) cursor = 'grabbing';
  else if (hoveredHandleId) cursor = 'grab';
  else if (hoveredId != null && !armedTypeId) {
    const pinnedCut = hoveredId === 'cut' && !cut?.movable;
    cursor = removeMode || pinnedCut || runLocked ? 'pointer' : 'grab';
  }

  const handlePointerUp = (e) => {
    const press = pressRef.current;
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_MOVE_THRESHOLD) return;
    if (press.target === 'armed' && armedTypeId) {
      onPlaceClick(e.clientX, e.clientY, { shiftKey: e.shiftKey, altKey: e.altKey });
    } else if (press.target === 'object') {
      if (removeMode) {
        onDeleteCharge(press.id);
        setHoveredId(null);
      } else {
        onSelect(press.id);
      }
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="viewer"
      style={{ cursor }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        setHoveredId(null);
        setHoveredHandle(null);
      }}
    >
      <Canvas
        camera={{ position: INITIAL_CAMERA_POSITION, up: [0, 0, 1], fov: CAMERA_FOV }}
        style={{ width: '100%', height: '100%' }}
        onPointerMissed={handlePointerMissed}
      >
        <color attach="background" args={['#f4f5f7']} />
        <ambientLight intensity={1.2} />
        <CameraLight />

        {showGrid && (view2D && cut ? <Floor axis={cut.axis} offset={cut.offset} /> : <Floor />)}
        {showAxes && <Axes hiddenAxis={view2D && cut ? cut.axis : null} />}
        {/* With a valid 2D cut, its lines are painted on it, over the 3D
            lines, which fade -- and in 2D, they're all there is. Arrows
            are the 3D grid's, or in 2D a grid in the cut. */}
        {showField && fieldStyle === 'lines' && !view2D && <FieldLines sources={sources} density={fieldDensity} faded={!!cut?.valid} />}
        {showField && fieldStyle === 'lines' && cut?.valid && <FieldLines sources={sources} density={fieldDensity} cut={cut} />}
        {showField && fieldStyle === 'arrows' && <FieldArrows sources={sources} density={fieldDensity} cut={view2D ? cut : null} />}

        {pointCharges.map((charge) => (
          <ChargeMarker
            key={charge.id}
            q={charge.q}
            position={charge.position}
            highlighted={charge.id === draggingId || (draggingId == null && charge.id === hoveredId)}
            selected={charge.id === selectedId}
            free={isFree(charge)}
            label={isFree(charge) ? freeLabelText(charge.freeLabel) : null}
            showGuides={charge.id === draggingId}
          />
        ))}
        {pointCharges.filter(isFree).map((charge) => (
          <group key={`motion-${charge.id}`}>
            {charge.showVelocity && <VelocityArrow position={charge.position} velocity={charge.velocity} />}
            {charge.showPredictedPath && run && (
              <PredictedPath run={run} index={run.ids.indexOf(charge.id)} charge={charge} />
            )}
          </group>
        ))}

        {objects.map((obj) => (
          <ChargedObject key={obj.id} charge={obj} selected={obj.id === selectedId} />
        ))}
        {/* The dragged object's (or cut's) guides, for the coordinates it
            can change. */}
        {draggedObject && (
          <PositionGuides
            position={draggedObject.position ?? [0, 0, 0]}
            segments={objectGuideSegments(draggedObject)}
            footDot={draggedObject.kind === 'sphere'}
            lineWidth={draggedObject.kind === 'plane' || draggedObject.kind === 'cut' ? 3 : undefined}
          />
        )}

        {shownProbes.map((probe) => {
          const reading = probeReading(charges, probe.position);
          // Each charge's own field there, where the field is defined.
          const contributions = probe.showContributions && reading.field
            ? charges.map((c) => ({ id: c.id, field: objectField(c, probe.position), color: chargeColor(c) }))
            : null;
          return (
            <group key={probe.id}>
              <ProbeMarker
                position={probe.position}
                label={probe.label}
                reading={reading}
                highlighted={probe.id === draggingId || (draggingId == null && probe.id === hoveredId)}
                selected={probe.id === selectedId}
                showGuides={probe.id === draggingId}
                showComponents={probe.showComponents}
                contributions={contributions}
              />
              {/* Where the field has no single value, neither does its
                  line. */}
              {probe.showFieldLine && reading.field && <ProbeFieldLine position={probe.position} sources={sources} cut={view2D ? cut : null} />}
            </group>
          );
        })}

        {cut && !view2D && <CutPlane cut={cut} charges={sources} selected={selectedId === 'cut'} />}

        {selectedObject && <ObjectHandles charge={selectedObject} hoveredId={hoveredHandleId} activeId={handleDrag?.id} isHidden={handleHidden} />}

        {ghost && (ghost.kind === 'probe'
          ? <ProbeMarker position={ghost.position} reading={probeReading(charges, ghost.position)} ghost showGuides />
          : ghost.kind === 'point'
            ? <ChargeMarker q={ghost.q} position={ghost.position} ghost showGuides />
            : <ChargedObject charge={ghost} ghost />)}

        {/* makeDefault registers these as the scene's controls. Left-drag
            rotates, scroll/pinch zooms, and right-drag (or two-finger drag)
            pans. */}
        <OrbitControls
          ref={controlsRef}
          target={INITIAL_CAMERA_TARGET}
          enableRotate={!view2D}
          mouseButtons={view2D ? PAN_MOUSE_BUTTONS : ORBIT_MOUSE_BUTTONS}
          touches={view2D ? PAN_TOUCHES : ORBIT_TOUCHES}
          makeDefault
        />

        <CoordinateReadoutTracker panelRef={readoutPanelRef} position={readout?.position ?? null} />

        {/* Orientation widget in the lower-left corner, above the view
            controls' buttons (App.jsx). Clicking one of its axis labels
            swings the camera around to look along that axis (see
            AxisGizmo.jsx and cameraViews.js). */}
        <CameraAnimator ref={cameraAnimatorRef} controlsRef={controlsRef} />
        {/* In 2D, a 3D inset (App.jsx) takes the gizmo's place. */}
        {!view2D && (
          <GizmoHelper alignment="bottom-left" margin={VIEW_CONTROLS_GIZMO_MARGIN}>
            <AxisGizmo onAxisClick={(axis) => cameraAnimatorRef.current?.viewAlong(axis)} />
          </GizmoHelper>
        )}
      </Canvas>

      {readout && <CoordinateReadoutPanel panelRef={readoutPanelRef} position={readout.position} axes={readout.axes} label={readout.label} value={readout.value} />}
    </div>
  );
}
