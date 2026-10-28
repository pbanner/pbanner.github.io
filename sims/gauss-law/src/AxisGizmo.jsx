import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture } from 'three';
import { sphericalAround, positionAround, axisView, shortestTurn } from './cameraViews.js';

// The orientation gizmo in the lower-left corner, and the camera move it
// triggers. drei's GizmoHelper still draws it (in its own overlay, turned
// to match the main camera every frame), but drei's own GizmoViewport is
// replaced by AxisGizmo below, since its camera move (a straight rotation
// between orientations) rolls the view through tilted poses and can end up
// rolled at the poles; see cameraViews.js for the move used instead.

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

// Swings the camera to look along an axis (viewAlong) by orbiting it
// around the OrbitControls target: the polar angle and azimuth (see
// cameraViews.js) change together along a straight line, with the azimuth
// going the short way around, eased in and out. Keeping the camera's up at
// +z, like OrbitControls does, the camera's rate of turning is
// sqrt(azimuth rate^2 + polar rate^2), so that straight line is the
// smallest total turn that keeps the view upright.
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
      const target = controls.target.toArray();
      const from = sphericalAround(controls.object.position.toArray(), target);
      const to = axisView(axis, from);
      const dPolar = to.polar - from.polar;
      const dAzimuth = shortestTurn(from.azimuth, to.azimuth);
      const angle = Math.hypot(dPolar, dAzimuth);
      if (angle < 1e-6) return;
      const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, angle / TURN_RATE));
      move.current = { from, dPolar, dAzimuth, target, duration, elapsed: 0 };
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
    const position = positionAround(
      { r: m.from.r, polar: m.from.polar + eased * m.dPolar, azimuth: m.from.azimuth + eased * m.dAzimuth },
      m.target,
    );
    controls.object.position.set(...position);
    controls.update(); // re-aims the camera at the target, upright
    if (t >= 1) move.current = null;
  });

  return null;
}
