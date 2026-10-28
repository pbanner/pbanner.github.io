import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Quaternion, Vector3 } from 'three';
import { axisViewOrientation } from './cameraViews.js';

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

// Turns the camera to look along an axis (viewAlong) by the smallest
// rotation from its current orientation to the chosen end orientation (see
// cameraViews.js): a slerp, the rotation's shortest path, eased in and out,
// with the camera kept at its distance from the target, behind the
// direction it looks. The view may roll or flip on the way. Throughout, the
// camera's `up` follows the screen's up: OrbitControls (drei's, from
// three-stdlib) works out its orbit axis from `up` and re-aims the camera
// with it on every update, so it then reproduces each frame's orientation
// rather than levelling it, and after the move, dragging the view orbits
// around whatever is up on screen.
//
// Grabbing the view mid-move (OrbitControls' 'start' event) cancels the
// move, so the hand always wins. That's also why the gizmo starts moves on
// a click rather than on pointerdown: the gizmo is drawn on the same
// canvas, so pressing on it also fires 'start', which would cancel a move
// begun on that same press.
export function CameraAnimator({ ref, controlsRef }) {
  const move = useRef(null);

  useImperativeHandle(ref, () => ({
    viewAlong(axis) {
      const controls = controlsRef.current;
      if (!controls) return;
      const camera = controls.object;
      const from = camera.quaternion.clone();
      const { quaternion: to } = axisViewOrientation(from, axis);
      const angle = from.angleTo(to);
      if (angle < 1e-6) return;
      const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, angle / TURN_RATE));
      const distance = camera.position.distanceTo(controls.target);
      move.current = { from, to, distance, duration, elapsed: 0 };
    },
    cancel() {
      move.current = null;
    },
  }));

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
    if (!m || !controls) return;
    m.elapsed += delta;
    const t = Math.min(1, m.elapsed / m.duration);
    const eased = t * t * (3 - 2 * t); // smoothstep: starts and ends gently
    const q = new Quaternion().slerpQuaternions(m.from, m.to, eased);
    const camera = controls.object;
    camera.quaternion.copy(q);
    camera.position.copy(new Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(m.distance).add(controls.target));
    camera.up.set(0, 1, 0).applyQuaternion(q);
    if (t >= 1) move.current = null;
  });

  return null;
}
