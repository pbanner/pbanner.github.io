import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Quaternion, Spherical, Vector3 } from 'three';
import { axisViewOrientation, stopMomentum } from './cameraViews.js';

// The orientation gizmo in the lower-left corner, and the camera move it
// triggers. drei's GizmoHelper still draws it (in its own overlay, turned
// to match the main camera every frame), but drei's own GizmoViewport is
// replaced by AxisGizmo below: its move's end orientation was built with
// lookAt along the camera's own up axis for the top and bottom views, where
// the roll is undefined, and OrbitControls then partly undid whatever roll
// it ended with, so views could end up turned at odd angles. See
// cameraViews.js for how the end orientation is chosen instead.

const AXIS_COLORS = ['#ff2060', '#20df80', '#2080ff']; // drei's defaults
const AXIS_LABELS = ['X', 'Y', 'Z'];
const AXIS_DIRECTIONS = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const HEAD_SCALE = 0.9;

// Camera moves turn at about this many radians per second, within these
// bounds on how long a move takes.
const TURN_RATE = 1.5 * Math.PI;
const MIN_DURATION = 0.25;
const MAX_DURATION = 0.8;

// The orbit (see CameraAnimator's startOrbit): a lap every ORBIT_LAP
// seconds once it's up to speed, which takes ORBIT_EASE_IN seconds. On the
// way round, the camera rises and falls ORBIT_TILT radians either side of
// its starting height, once a lap. Its polar angle -- from the orbit axis,
// as OrbitControls measures it -- stays at least ORBIT_POLE_MARGIN from
// either end of OrbitControls' 0 to pi range (see startOrbit).
const DEG = Math.PI / 180;
const ORBIT_LAP = 18;
const ORBIT_EASE_IN = 1;
const ORBIT_TILT = 15 * DEG;
const ORBIT_POLE_MARGIN = 10 * DEG;
// A frame's time step is capped at this many seconds, so that coming back
// to a tab that was hidden (where frames stop) doesn't jump the orbit ahead.
const MAX_FRAME_STEP = 0.1;

const smoothstep = (x) => x * x * (3 - 2 * x);
// How far round the orbit has gone, in radians, `t` seconds in. Its speed
// rises from 0 along a smoothstep over the ease-in, then holds steady; this
// is that speed integrated (the integral of 3x^2 - 2x^3 is x^3 - x^4 / 2).
function orbitAngle(t) {
  const speed = (2 * Math.PI) / ORBIT_LAP;
  if (t >= ORBIT_EASE_IN) return speed * (t - ORBIT_EASE_IN / 2);
  const x = t / ORBIT_EASE_IN;
  return speed * ORBIT_EASE_IN * (x ** 3 - x ** 4 / 2);
}

// One clickable axis end: a colored disc, with the axis name on the
// positive end, that grows a little while hovered (same look as drei's).
function AxisHead({ direction, color, label, onAxisClick }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(32, 32, 16, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    if (label) {
      ctx.font = '18px Inter var, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'white';
      ctx.fillText(label, 32, 41);
    }
    return new CanvasTexture(canvas);
  }, [color, label]);
  useEffect(() => () => texture.dispose(), [texture]);
  const [hovered, setHovered] = useState(false);
  return (
    <sprite
      position={direction}
      scale={(label ? 1 : 0.75) * (hovered ? 1.2 : 1) * HEAD_SCALE}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false); }}
      // A click (pointerup), not pointerdown: see CameraAnimator.
      onClick={(e) => { e.stopPropagation(); onAxisClick(direction); }}
    >
      <spriteMaterial map={texture} alphaTest={0.3} opacity={label ? 1 : 0.75} toneMapped={false} />
    </sprite>
  );
}

// The gizmo itself, drawn inside drei's GizmoHelper: three axis bars and
// a clickable head at each end. Clicking a head calls onAxisClick with that
// axis's unit vector (e.g. [-1, 0, 0] for -x).
export function AxisGizmo({ onAxisClick }) {
  return (
    <group scale={40}>
      {AXIS_DIRECTIONS.map((dir, i) => (
        <group key={i}>
          <mesh position={dir.map((c) => c * 0.4)} rotation={[0, i === 2 ? -Math.PI / 2 : 0, i === 1 ? Math.PI / 2 : 0]}>
            <boxGeometry args={[0.8, 0.05, 0.05]} />
            <meshBasicMaterial color={AXIS_COLORS[i]} toneMapped={false} />
          </mesh>
          <AxisHead direction={dir} color={AXIS_COLORS[i]} label={AXIS_LABELS[i]} onAxisClick={onAxisClick} />
          <AxisHead direction={dir.map((c) => -c)} color={AXIS_COLORS[i]} onAxisClick={onAxisClick} />
        </group>
      ))}
    </group>
  );
}

// Moves the camera smoothly. viewAlong(axis) turns it to look along an
// axis by the smallest rotation from its current orientation to the chosen
// end orientation (see cameraViews.js): a slerp, the rotation's shortest
// path, eased in and out, with the camera kept at its distance from the
// target, behind the direction it looks. The view may roll or flip on the
// way.
//
// moveTo(goal, duration) is the general move, which the 2D cut's view
// uses: at once, it turns the camera (slerp), moves the point it orbits
// (`target`), and changes its field of view (`fov`) and how much of the
// scene fits on screen -- `height`, the height visible at the target, in
// world units. The camera's distance from the target follows from those
// two: height = 2 distance tan(fov / 2). Narrowing the field of view while
// keeping the height (a "dolly zoom") flattens the perspective: at a few
// degrees, near and far things are drawn at practically the same scale.
// state() is the camera's current { quaternion, target, fov, height, up },
// to come back to; a goal with an `up` puts that back as the camera's up
// when the move ends (see below). With `lock`, the view can't be grabbed
// until the move is over -- for the 2D cut's view, which would otherwise be
// left half-turned and half-flattened.
//
// Every move starts by stopping whatever motion OrbitControls still has
// from the last drag (stopMomentum), which would otherwise carry on
// turning the camera during and after the move.
//
// Throughout, the camera's `up` follows the screen's up: OrbitControls
// (drei's, from three-stdlib) works out its orbit axis from `up` and
// re-aims the camera with it on every update, so it then reproduces each
// frame's orientation rather than levelling it, and after the move,
// dragging the view orbits around whatever is up on screen.
//
// Grabbing the view mid-move (OrbitControls' 'start' event) cancels the
// move, so the hand always wins. That's also why the gizmo starts moves on
// a click rather than on pointerdown: the gizmo is drawn on the same
// canvas, so pressing on it also fires 'start', which would cancel a move
// begun on that same press.
//
// startOrbit() sets the camera orbiting until stopOrbit(): round and round
// the axis that's up on screen (the camera's `up`, which is also the axis
// OrbitControls turns a sideways drag about), through the target, rising
// and falling a little once a lap. It's worked in OrbitControls' own
// terms: spherical coordinates about `up`, with the polar angle measured
// from `up` and the azimuth around it, so the camera is placed exactly as
// OrbitControls would place it, and its own update each frame changes
// nothing. The distance is read fresh every frame, so scrolling to zoom
// works during the orbit; nothing here stops it but stopOrbit() (Viewer.jsx
// calls that for any press on the view). It starts once any move under way
// has finished.
const visibleHeight = (distance, fov) => 2 * distance * Math.tan((fov * Math.PI) / 360);

export function CameraAnimator({ ref, controlsRef }) {
  const move = useRef(null);
  // The orbit, while there is one: { pending: true } until it starts, then
  // what it started from (see beginOrbit).
  const orbit = useRef(null);

  const state = () => {
    const controls = controlsRef.current;
    const camera = controls.object;
    return {
      quaternion: camera.quaternion.clone(),
      target: controls.target.clone(),
      fov: camera.fov,
      height: visibleHeight(camera.position.distanceTo(controls.target), camera.fov),
      up: camera.up.clone(),
    };
  };
  const moveTo = (goal, duration, { lock = false } = {}) => {
    const controls = controlsRef.current;
    if (!controls) return;
    stopMomentum(controls);
    controls.enabled = !lock;
    move.current = { from: state(), to: goal, duration, elapsed: 0 };
  };

  useImperativeHandle(ref, () => ({
    viewAlong(axis) {
      if (!controlsRef.current) return;
      const from = state();
      const { quaternion } = axisViewOrientation(from.quaternion, axis);
      const angle = from.quaternion.angleTo(quaternion);
      if (angle < 1e-6) return;
      // No `up` in the goal: the camera ends with up along the new
      // screen-up, as it is throughout the move.
      const goal = { ...from, quaternion };
      delete goal.up;
      moveTo(goal, Math.min(MAX_DURATION, Math.max(MIN_DURATION, angle / TURN_RATE)));
    },
    moveTo,
    state,
    cancel() {
      move.current = null;
      if (controlsRef.current) controlsRef.current.enabled = true;
    },
    startOrbit() {
      orbit.current = { pending: true };
    },
    stopOrbit() {
      orbit.current = null;
    },
  }));

  // The orbit's starting point, worked out as OrbitControls' update() does
  // (three-stdlib): `toYUp` turns the camera's up onto +y, where three's
  // Spherical measures its polar angle `phi` (from +y) and azimuth `theta`
  // (around it). The camera's polar angle at the start is kept: it's the
  // middle of the rise and fall. Except that within ORBIT_TILT +
  // ORBIT_POLE_MARGIN of either pole -- looking almost straight down or up
  // the orbit axis -- that would take the camera past the pole, where it
  // would flip over, so the middle is eased away from it over the ease-in
  // (`phiMiddle`).
  const beginOrbit = (controls) => {
    stopMomentum(controls);
    const camera = controls.object;
    const toYUp = new Quaternion().setFromUnitVectors(camera.up.clone().normalize(), new Vector3(0, 1, 0));
    const start = new Spherical().setFromVector3(camera.position.clone().sub(controls.target).applyQuaternion(toYUp));
    const limit = ORBIT_TILT + ORBIT_POLE_MARGIN;
    return {
      fromYUp: toYUp.clone().invert(),
      theta: start.theta,
      phi: start.phi,
      phiMiddle: Math.min(Math.PI - limit, Math.max(limit, start.phi)),
      elapsed: 0,
    };
  };

  // One frame of the orbit. Going round is increasing theta, which is
  // counterclockwise seen from above (looking down the orbit axis). The
  // polar angle is phi = middle - tilt sin(angle): it falls first (the
  // camera rises), and the rise and fall comes round once a lap, as the
  // lap's angle does.
  const stepOrbit = (o, controls, delta) => {
    const camera = controls.object;
    o.elapsed += Math.min(delta, MAX_FRAME_STEP);
    const angle = orbitAngle(o.elapsed);
    const middle = o.phi + (o.phiMiddle - o.phi) * smoothstep(Math.min(1, o.elapsed / ORBIT_EASE_IN));
    const phi = middle - ORBIT_TILT * Math.sin(angle);
    const distance = camera.position.distanceTo(controls.target);
    const offset = new Vector3().setFromSphericalCoords(distance, phi, o.theta + angle).applyQuaternion(o.fromYUp);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
  };

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return undefined;
    const cancel = () => { move.current = null; };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controlsRef]);

  useFrame((_, delta) => {
    const m = move.current;
    const controls = controlsRef.current;
    if (!controls) return;
    if (!m && orbit.current) {
      if (orbit.current.pending) orbit.current = beginOrbit(controls);
      stepOrbit(orbit.current, controls, delta);
      return;
    }
    if (!m) return;
    m.elapsed += delta;
    const t = Math.min(1, m.elapsed / m.duration);
    const eased = t * t * (3 - 2 * t); // smoothstep: starts and ends gently
    const { from, to } = m;
    const q = new Quaternion().slerpQuaternions(from.quaternion, to.quaternion, eased);
    const fov = from.fov + (to.fov - from.fov) * eased;
    const height = from.height + (to.height - from.height) * eased;
    const distance = height / (2 * Math.tan((fov * Math.PI) / 360));
    const camera = controls.object;
    controls.target.lerpVectors(from.target, to.target, eased);
    camera.quaternion.copy(q);
    camera.position.copy(new Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(distance).add(controls.target));
    camera.up.set(0, 1, 0).applyQuaternion(q);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (t >= 1) {
      if (to.up) camera.up.copy(to.up);
      controls.enabled = true;
      move.current = null;
    }
  });

  return null;
}
