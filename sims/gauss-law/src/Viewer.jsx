import { useImperativeHandle, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls, GizmoHelper } from '@react-three/drei';
import { ChargeDrag } from './chargeDrag.js';
import ChargeMarker from './ChargeMarker.jsx';
import ChargedObject from './ChargedObject.jsx';
import ObjectHandles from './ObjectHandles.jsx';
import CutPlane from './CutPlane.jsx';
import { objectHandles, LineDrag } from './handles.js';
import Axes from './Axes.jsx';
import { AxisGizmo, CameraAnimator } from './AxisGizmo.jsx';
import FieldLines from './FieldLines.jsx';
import FieldArrows from './FieldArrows.jsx';
import { CoordinateReadoutPanel, CoordinateReadoutTracker } from './CoordinateReadout.jsx';
import { rayFromClient, pickCharge, pickObject, snapValue, clampToWorld, SNAP_STEP } from './geometry.js';
import { WORLD_HALF_EXTENT, CHARGE_RADIUS, INITIAL_CAMERA_POSITION, INITIAL_CAMERA_TARGET, CAMERA_FOV, CLICK_MOVE_THRESHOLD, VIEW_CONTROLS_GIZMO_MARGIN } from './sceneConstants.js';

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
//
// The grid is drawn first (renderOrder -1) and doesn't write depth, so
// anything else at z = 0 -- the axes, a dragged charge's guides -- always
// draws over it instead of z-fighting with the grid lines it overlaps.
const GRID_COLOR = '#d3d7dc';
function Floor() {
  const size = 2 * WORLD_HALF_EXTENT;
  return (
    <gridHelper args={[size, Math.round(size / SNAP_STEP), GRID_COLOR, GRID_COLOR]} rotation={[Math.PI / 2, 0, 0]} renderOrder={-1} material-depthWrite={false} />
  );
}

// charges: everything placed, [{ id, kind, ... }] (see chargeField.js).
//   They're also the field's sources, as they are, and since App.jsx only
//   makes a new array when a charge changes,
//   a re-render for anything else (e.g. the hover highlight) doesn't
//   recompute the field. The placement ghost isn't a source: only placed
//   charges make a field.
// ghost: the charge that click- or drag-to-place would add (see
//   chargeTypes.js's makeCharge), drawn as a translucent preview, or null
// armedTypeId: the charge type waiting for click-to-place's second click
// onPlaceClick(clientX, clientY, modifiers): that second click, on the canvas
// removeMode: the sidebar's delete tool is on, so clicking a charge deletes it
// selectedId / onSelect(id or null): the charge selected for the properties
//   panel. Pressing on a charge selects it; clicking empty space deselects.
// onMoveCharge(id, position) / onUpdateCharge(id, changes) /
//   onDeleteCharge(id): edits to placed charges ('cut' for the 2D cut)
// cut: the 2D cut, where it is (cutPlanes.js's placeCut), or null.
//   Selected as 'cut', it has a handle that slides it along its axis
//   (onMoveCut(offset)), when the charges allow that.
// showGrid / showAxes / showField / fieldStyle ('lines' or 'arrows') /
//   fieldDensity: the Display Options panel's settings
export default function Viewer({ ref, charges, ghost, armedTypeId, onPlaceClick, removeMode, selectedId, onSelect, onMoveCharge, onUpdateCharge, onDeleteCharge, cut, onMoveCut, showGrid, showAxes, showField, fieldStyle, fieldDensity }) {
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
  const readoutPanelRef = useRef(null);


  // Can't use controls.reset(): drei captures the controls' saved state
  // before applying the `target` prop, so reset() would aim at the wrong
  // point (same issue the Bloch sphere sim works around). Set both
  // explicitly instead.
  const resetView = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    cameraAnimatorRef.current?.cancel(); // a gizmo move in progress would otherwise carry on from here
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
    placementRef.current = new ChargeDrag();
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

  // Moves a placed charge, following the same ChargeDrag rules as a
  // placement once it's been lifted: drag to slide it horizontally,
  // Shift+drag to raise or lower it.
  const startDrag = (charge, downEvent) => {
    const drag = new ChargeDrag(charge.position);
    dragRef.current = { id: charge.id, drag };
    setDraggingId(charge.id);

    const update = (ev) => {
      const controls = controlsRef.current;
      if (!dragRef.current || !controls) return;
      // Deliberately not rayAt(): the drag should keep working even while
      // the pointer passes over an overlay (e.g. on its way to the trash).
      const ray = rayFromClient(controls.object, wrapperRef.current.getBoundingClientRect(), ev.clientX, ev.clientY);
      const before = drag.position;
      const after = drag.update({ ray, camera: controls.object, shiftKey: ev.shiftKey, altKey: ev.altKey });
      if (after !== before) onMoveCharge(charge.id, after);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDraggingId(null);
      // Dropping a charge on the sidebar's trash can deletes it.
      if (d && document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-role="trash-target"]')) {
        onDeleteCharge(d.id);
      }
    };
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    // Anchor at the press itself, so the very first pixels of movement count.
    update(downEvent);
  };

  // Point charges are picked, dragged and drawn as ChargeMarkers; the
  // charged spheres, rods and planes ("objects") as ChargedObjects.
  const pointCharges = charges.filter((c) => c.kind === 'point');
  const objects = charges.filter((c) => c.kind !== 'point');

  // The 2D cut, as something to pick and give handles to, like an object.
  const cutObject = cut && { kind: 'cut', id: 'cut', ...cut };

  // What's under a viewport point, if anything: { charge, isPoint }. A
  // point charge wins over an object, even one in front of it -- a charge
  // inside a shell would otherwise be impossible to reach -- and an object
  // over the 2D cut, which crosses the whole box.
  const pickAt = (clientX, clientY) => {
    const ray = rayAt(clientX, clientY);
    if (!ray) return null;
    const point = pickCharge(ray, pointCharges, CHARGE_RADIUS);
    if (point) return { charge: point, isPoint: true };
    const obj = pickObject(ray, objects);
    if (obj) return { charge: obj, isPoint: false };
    // The cut is picked like a sheet at its position.
    const cutPosition = cut && [0, 1, 2].map((k) => (k === cut.axis ? cut.offset : 0));
    if (cut && pickObject(ray, [{ kind: 'plane', form: 'sheet', axis: cut.axis, position: cutPosition }])) {
      return { charge: cutObject, isPoint: false };
    }
    return null;
  };

  // The selected sphere, rod, plane or 2D cut, whose handles (handles.js)
  // are shown -- except while placing something or deleting.
  const selectedObject = armedTypeId || removeMode ? null
    : selectedId === 'cut' ? cutObject
    : objects.find((c) => c.id === selectedId) ?? null;
  // The handle under the pointer, and the one being dragged, if any: { id,
  // label, value, position } -- the readout shows label = value, floating
  // above the handle's position.
  const [hoveredHandleId, setHoveredHandleId] = useState(null);
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
      if (h.disabled) continue;
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

  // Drags one of the selected object's handles. The move handle drags the
  // object like a point charge (startDrag: sideways, or with Shift up and
  // down, and onto the trash to delete it); the others drag a single value
  // along their line (LineDrag), kept within the box and at least
  // MIN_SIZE for a radius or thickness.
  const MIN_SIZE = SNAP_STEP / 2;
  const startHandleDrag = (obj, handle, downEvent) => {
    if (handle.id === 'move') {
      startDrag(obj, downEvent);
      return;
    }
    const axis = obj.axis;
    const size = (v) => Math.min(2 * WORLD_HALF_EXTENT, Math.max(MIN_SIZE, v));
    // For each handle: where its line starts from and the value it drags,
    // how a new value changes the object, and the readout's label and
    // value.
    let drag;
    let apply;
    let label;
    let valueOf;
    if (obj.kind === 'cut') {
      drag = new LineDrag(handle.position, handle.direction, obj.offset);
      apply = (v) => ({ offset: clampToWorld(v) });
      [label, valueOf] = [['x', 'y', 'z'][axis], (o) => o.offset];
    } else if (handle.id === 'lift') {
      drag = new LineDrag(handle.position, handle.direction, obj.position[2]);
      apply = (v) => ({ position: [obj.position[0], obj.position[1], clampToWorld(v)] });
      [label, valueOf] = ['z', (o) => o.position[2]];
    } else if (handle.id === 'radius') {
      drag = new LineDrag(handle.position, handle.direction, obj.radius);
      apply = (v) => ({ radius: size(v) });
      [label, valueOf] = ['r', (o) => o.radius];
    } else if (handle.id === 'position') {
      drag = new LineDrag(handle.position, handle.direction, obj.position[axis]);
      apply = (v) => {
        const position = [0, 0, 0];
        position[axis] = clampToWorld(v);
        return { position };
      };
      [label, valueOf] = [['x', 'y', 'z'][axis], (o) => o.position[axis]];
    } else {
      // Thickness: the face moves half as far as the thickness changes, so
      // the thickness is snapped rather than the face's position.
      drag = new LineDrag(handle.position, handle.direction, obj.thickness / 2, (v) => v);
      apply = (v, altKey) => ({ thickness: size(altKey ? 2 * v : snapValue(2 * v)) });
      [label, valueOf] = ['thickness', (o) => o.thickness];
    }

    const update = (ev) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const ray = rayFromClient(controls.object, wrapperRef.current.getBoundingClientRect(), ev.clientX, ev.clientY);
      const changes = apply(drag.update(ray, ev.altKey), ev.altKey);
      if (obj.kind === 'cut') onMoveCut(changes.offset);
      else onUpdateCharge(obj.id, changes);
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
  // left-drag mean two different things: on a point charge,
  // stopPropagation() here keeps OrbitControls from ever seeing the press,
  // so the charge moves and the camera doesn't; on empty space it passes
  // through untouched and the camera orbits.
  //
  // An object isn't moved by dragging it (a big sphere or a plane covers
  // so much of the view that the camera could hardly be turned), so a
  // press on one passes through to OrbitControls too, and it's only
  // selected (or, in delete mode, deleted) if the press turns out to be a
  // click -- see handlePointerUp.
  //
  // Instead, a selected object has handles, which come first: a press on
  // one is kept from OrbitControls, like a press on a point charge, and
  // drags it.
  //
  // While a charge is armed, this just records the press for
  // click-to-place's second click, which is likewise acted on at pointerup
  // only if the pointer barely moved -- so a real drag still orbits the
  // camera, and only a genuine click drops the charge.
  const handlePointerDownCapture = (e) => {
    pressRef.current = null;
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
    if (!picked.isPoint) {
      pressRef.current = { target: 'object', id: picked.charge.id, ...at };
      return;
    }
    pressRef.current = { target: 'point', ...at };
    e.stopPropagation();
    if (removeMode) {
      onDeleteCharge(picked.charge.id);
      setHoveredId(null);
    } else {
      onSelect(picked.charge.id);
      startDrag(picked.charge, e);
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
    const handleId = pickHandle(e.clientX, e.clientY)?.id ?? null;
    if (handleId !== hoveredHandleId) setHoveredHandleId(handleId);
    const id = handleId ? null : pickAt(e.clientX, e.clientY)?.charge.id ?? null;
    if (id !== hoveredId) setHoveredId(id);
  };

  // The readout: while a handle drags a single value, that value (e.g.
  // "r = 3"), floating above the handle; otherwise the coordinates of the
  // charge or object being dragged, or else of the placement ghost.
  let readout = null;
  if (handleDrag) {
    readout = handleDrag;
  } else {
    const position = charges.find((c) => c.id === draggingId)?.position ?? ghost?.position ?? null;
    if (position) readout = { position };
  }

  // Over a point charge or a handle: grab (it can be dragged). Over an
  // object: a pointing hand (it can be clicked).
  let cursor;
  if (draggingId != null || handleDrag) cursor = 'grabbing';
  else if (hoveredHandleId) cursor = 'grab';
  else if (hoveredId != null && !armedTypeId) {
    const isPoint = pointCharges.some((c) => c.id === hoveredId);
    cursor = removeMode || !isPoint ? 'pointer' : 'grab';
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
        setHoveredHandleId(null);
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

        {showGrid && <Floor />}
        {showAxes && <Axes />}
        {showField && fieldStyle === 'lines' && <FieldLines sources={charges} density={fieldDensity} />}
        {showField && fieldStyle === 'arrows' && <FieldArrows sources={charges} density={fieldDensity} />}

        {pointCharges.map((charge) => (
          <ChargeMarker
            key={charge.id}
            q={charge.q}
            position={charge.position}
            highlighted={charge.id === draggingId || (draggingId == null && charge.id === hoveredId)}
            selected={charge.id === selectedId}
            showGuides={charge.id === draggingId}
          />
        ))}

        {objects.map((obj) => (
          <ChargedObject key={obj.id} charge={obj} selected={obj.id === selectedId} />
        ))}

        {cut && <CutPlane cut={cut} charges={charges} selected={selectedId === 'cut'} />}

        {selectedObject && <ObjectHandles charge={selectedObject} hoveredId={hoveredHandleId} activeId={handleDrag?.id} />}

        {ghost && (ghost.kind === 'point'
          ? <ChargeMarker q={ghost.q} position={ghost.position} ghost showGuides />
          : <ChargedObject charge={ghost} ghost />)}

        {/* makeDefault registers these as the scene's controls. Left-drag
            rotates, scroll/pinch zooms, and right-drag (or two-finger drag)
            pans. */}
        <OrbitControls ref={controlsRef} target={INITIAL_CAMERA_TARGET} makeDefault />

        <CoordinateReadoutTracker panelRef={readoutPanelRef} position={readout?.position ?? null} />

        {/* Orientation widget in the lower-left corner, above the view
            controls' buttons (App.jsx). Clicking one of its axis labels
            swings the camera around to look along that axis (see
            AxisGizmo.jsx and cameraViews.js). */}
        <CameraAnimator ref={cameraAnimatorRef} controlsRef={controlsRef} />
        <GizmoHelper alignment="bottom-left" margin={VIEW_CONTROLS_GIZMO_MARGIN}>
          <AxisGizmo onAxisClick={(axis) => cameraAnimatorRef.current?.viewAlong(axis)} />
        </GizmoHelper>
      </Canvas>

      {readout && <CoordinateReadoutPanel panelRef={readoutPanelRef} position={readout.position} label={readout.label} value={readout.value} />}
    </div>
  );
}
