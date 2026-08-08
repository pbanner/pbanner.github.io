import React, { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import ThickArrowHelper from './ThickArrowHelper.jsx';
import { ketWidth, drawKet } from './ket.js';
import * as THREE from 'three';
import './App.css';

/********** Constants and initial values **********/
const SPHERE_INITIAL_CAMERA_POSITION = [3.6, 2.4, -3.6];
const SPHERE_INITIAL_CAMERA_TARGET = [0, 0.32, 0];
const SPHERE_AXIS_EXTENT = 1.3;  // Helps determine how far axis arrows and axis labels are drawn beyond the sphere itself

const FIELD_MAGNITUDE_DISPLAY_FACTOR = 0.2;

// A stable placeholder array for <Line> refs that get updated through imperative handles
const LINE_PLACEHOLDER_POINTS = [[0, 0, 0], [0, 0, 0.001]];

/********** UI components and helpers **********/

// Unicode glyphs (▶ ⏸ ⌂) bake their own, font-dependent vertical padding
// into the glyph box, so flexbox centering lines up the boxes but not the
// visible ink — hence the icon-vs-text misalignment. Drawing the icons
// ourselves as SVG paths sidesteps that: there's no hidden glyph metrics,
// so `alignItems: 'center'` centers exactly what's visible.
function PlayIcon({ size = '0.9em' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M4 2l10 6-10 6z" />
    </svg>
  );
}

function PauseIcon({ size = '0.9em' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="3" y="2" width="4" height="12" />
      <rect x="9" y="2" width="4" height="12" />
    </svg>
  );
}

// For rendering a label, slider, AND textbox all at once
function SliderPlusTextboxControl({ label, valueNum, onChangeNum, min, max, step, disabled = false }) {
  return (
    <div className="control-group">
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <label style={{ margin: '0em 0em' }}>{label}</label> {/*: {valueNum.toFixed(1)}*/}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueNum}
          onChange={(e) => onChangeNum(parseFloat(e.target.value))}
          style={{ flex: 1 }}
          disabled={disabled}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={valueNum}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChangeNum(v);
          }}
          style={{ width: '70px', padding: '2px' }}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

/************************************************
*
* Physics helpers
*
************************************************/

// Standard physics spherical-to-Cartesian unit vector: theta measured from
// +z, phi azimuthal from +x toward +y. blochVectorFromState below is this
// same formula with a state-vector-specific meaning attached to theta/phi;
// this generic version is what the magnetic field's direction uses instead,
// since a field direction is just "which way it points," with no
// probability-amplitude meaning behind theta/phi.
function unitVectorFromAngles(theta, phi) {
  return {
    x: Math.sin(theta) * Math.cos(phi),
    y: Math.sin(theta) * Math.sin(phi),
    z: Math.cos(theta),
  };
}

// Rotates the physics-space unit vector v by `angle` radians (right-hand
// rule) about the unit vector `axis` -- Rodrigues' rotation formula. Used
// below to advance the spin's precession by its exact closed-form solution
// for a *static* field, rather than numerically stepping an ODE -- a static
// field's precession is a constant-rate rotation, so there's no
// approximation error to worry about computing it directly from elapsed
// time instead of integrating forward frame by frame.
function rotateAroundAxis(v, axis, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dot = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  const cross = {
    x: axis.y * v.z - axis.z * v.y,
    y: axis.z * v.x - axis.x * v.z,
    z: axis.x * v.y - axis.y * v.x,
  };
  return {
    x: v.x * cos + cross.x * sin + axis.x * dot * (1 - cos),
    y: v.y * cos + cross.y * sin + axis.y * dot * (1 - cos),
    z: v.z * cos + cross.z * sin + axis.z * dot * (1 - cos),
  };
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// An arbitrary but fixed pair of unit vectors perpendicular to n and to
// each other. There's no physically privileged transverse "zero" -- this
// just fixes one choice consistently, which is all phase1 needs.
function transverseBasis(n) {
  const helper = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const e1 = normalize(cross(n, helper));
  const e2 = cross(n, e1);
  return { e1, e2 };
}

// Exact solution for a static field plus one transverse-rotating
// component sharing the static field's axis: transform into the frame
// co-rotating with the drive (field looks static there), precess about
// the resulting fixed effective field, then rotate back to the lab frame.
function evolveSpin(spinState, field, t) {
  const n = unitVectorFromAngles(field.theta0, field.phi0);
  const { e1 } = transverseBasis(n);
  const Phi = field.omega1 * t + field.phase1;

  const beff = {
    x: (field.mag0 - field.omega1) * n.x + field.mag1 * e1.x,
    y: (field.mag0 - field.omega1) * n.y + field.mag1 * e1.y,
    z: (field.mag0 - field.omega1) * n.z + field.mag1 * e1.z,
  };
  const omegaEff = Math.sqrt(beff.x ** 2 + beff.y ** 2 + beff.z ** 2);

  const s0 = unitVectorFromAngles(spinState.theta, spinState.phi);
  const intoRotatingFrame = rotateAroundAxis(s0, n, -field.phase1);
  const precessed = omegaEff < 1e-9
    ? intoRotatingFrame
    : rotateAroundAxis(intoRotatingFrame, normalize(beff), -omegaEff * t);

  return rotateAroundAxis(precessed, n, Phi);
}

// The actual (magnitude-carrying) lab-frame field vector at time t -- used
// for the field arrow's direction/length and the axis line's direction.
function fieldDirectionAt(field, t) {
  const n = unitVectorFromAngles(field.theta0, field.phi0);
  const { e1, e2 } = transverseBasis(n);
  const Phi = field.omega1 * t + field.phase1;
  return {
    x: field.mag0 * n.x + field.mag1 * (Math.cos(Phi) * e1.x + Math.sin(Phi) * e2.x),
    y: field.mag0 * n.y + field.mag1 * (Math.cos(Phi) * e1.y + Math.sin(Phi) * e2.y),
    z: field.mag0 * n.z + field.mag1 * (Math.cos(Phi) * e1.z + Math.sin(Phi) * e2.z),
  };
}

function fieldMagnitudeAt(field, t) {
  const { x, y, z } = fieldDirectionAt(field, t);
  return Math.sqrt(x * x + y * y + z * z);
}

/************************************************
*
* Helpers for sphere drawing
*
************************************************/

// Maps a physics-space Bloch vector (x, y, z) -- z the polar/quantization
// axis -- to the Three.js scene's (x, y, z), where y is "up" by convention.
// Three.js's vertical axis needs to receive z, but simply swapping the last
// two components results in a left-handed coordinate system (said differently,
// +z points the wrong way). So negate the last axis. Everything drawn
// on the sphere -- the state arrow, the axis arrows, the graticule -- goes
// through this one function, so the whole scene shares one consistent,
// orientation-preserving convention.
function blochToThree(x, y, z) {
  return new THREE.Vector3(x, z, -y);
}

function blochVectorFromState(theta, phi) {
  return unitVectorFromAngles(theta, phi);
}

// AI taught me a new word: a "graticule" is a set of intersecting lines on a
// map that show a sphere's latitude (parallels) and longitude (meridians).
// One full ring of the sphere's orthogonal graticule, radius 1. Generated by
// holding one Bloch-vector component at zero and sweeping the other two,
// then mapped through blochToThree -- so every curve on the sphere shares
// the exact same physics-to-scene transform as the state arrow and the axis
// arrows below, rather than each needing its own hand-derived sign.
// This function generates the points which are then drawn by a "Line".
// More segments = smoother-looking ring.
function graticuleRing(fixedAxis, segments = 96) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    if (fixedAxis === 'z') pts.push(blochToThree(c, s, 0));       // x-y equator
    else if (fixedAxis === 'y') pts.push(blochToThree(c, 0, s));  // x-z meridian
    else pts.push(blochToThree(0, c, s));                          // y-z meridian
  }
  return pts;
}

// Drawn once per label text onto an offscreen 2D canvas, then used as a
// sprite texture. Sprites always billboard to face the camera, which is
// exactly what a floating axis label wants -- and unlike drei's <Html>,
// there's no DOM/CSS layer whose positioning can go wrong relative to the
// surrounding page.
function makeTextSpriteTexture(text, { color = '#333333', fontSizePx = 64 } = {}) {
  // Rendered well above the on-screen size the label actually ends up at, so
  // there's plenty of texel density to spare -- then sampled with plain
  // linear filtering and no mipmap chain, which for a mild downscale looks
  // crisper than relying on WebGL's own mip selection (the previous, blurry
  // result) or on the browser's own upscaling of a lower-res source.
  const supersample = 4;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `bold ${fontSizePx * supersample}px sans-serif`;
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  const padding = fontSizePx * supersample * 0.3;
  canvas.width = Math.ceil(textWidth + padding * 2);
  canvas.height = Math.ceil(fontSizePx * supersample * 1.4);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  //texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, aspect: canvas.width / canvas.height };
}
// Actual axis label, using the sprite code from above.
function AxisLabel({ text, position, size = 0.28 }) {
  const { texture, aspect } = useMemo(() => makeTextSpriteTexture(text), [text]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}
// Same idea as makeTextSpriteTexture, but for a pole/axis label like
// "|+>_z": the ket itself is drawn as vector shapes (see ket.js) rather
// than text, so its vertical alignment can't drift with whatever font
// "sans-serif" resolves to. Only the axis subscript is real text.
function makeKetSpriteTexture(sign, axis, { color = '#333333', sizePx = 64 } = {}) {
  const supersample = 4;
  const ketSize = sizePx * supersample;
  const subPx = ketSize * 0.5;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${subPx}px sans-serif`;
  const subWidth = ctx.measureText(axis).width;

  const gap = ketSize * -0.06;
  const padding = ketSize * 0.25;
  const kWidth = ketWidth(ketSize);
  const totalWidth = kWidth + gap + subWidth;

  canvas.width = Math.ceil(totalWidth + padding * 2);
  canvas.height = Math.ceil(ketSize * 1.3);

  ctx.fillStyle = color;
  const startX = (canvas.width - totalWidth) / 2;
  const midY = canvas.height / 2;

  drawKet(ctx, startX, midY, ketSize, sign);

  ctx.font = `bold ${subPx}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(axis, startX + kWidth + gap, midY + ketSize * 0.4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, aspect: canvas.width / canvas.height };
}

function KetLabel({ sign, axis, position, size = 0.20 }) {
  const { texture, aspect } = useMemo(() => makeKetSpriteTexture(sign, axis), [sign, axis]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

// For the sake of reducing overhead on updates that happen every frame
// (like animations), ThickArrowHelper has an ref/imperative handle structure
// that lets us reach in and set the arrow's direction directly, avoiding
// the overhead of the whole React re-render cycle. 
// So for arrows that need updating every frame, we directly attach a useFrame
// callback that reaches in and modifies the direction directly.
// A ThickArrowHelper whose direction is recomputed every frame from
// getDirection(t), where t is read from a shared simulation-time ref. This
// replaces having two separate arrow components (one static, one
// precessing) with one: a static field is just a getDirection that ignores
// t, a precessing spin is a getDirection that uses it. Every
// TimeDrivenArrow reads the *same* simTimeRef rather than keeping its own
// clock, so nothing can drift out of sync -- important once the field
// becomes genuinely time-dependent and its arrow, the spin arrow, and
// (eventually) a rotating-frame view all need to reflect the same instant.
function TimeDrivenArrow({ simTimeRef, getDirection, getLength, length, color, headLength, headWidth, shaftWidth }) {
  const arrowRef = useRef();
  useFrame(() => {
    const { x, y, z } = getDirection(simTimeRef.current);
    arrowRef.current?.setDirection(blochToThree(x, y, z));
    if (getLength) arrowRef.current?.setLength(getLength(simTimeRef.current), headLength, headWidth);
  });
  return (
    <ThickArrowHelper ref={arrowRef} dir={new THREE.Vector3(1, 0, 0)} origin={new THREE.Vector3(0, 0, 0)} length={length} color={color} headLength={headLength} headWidth={headWidth} shaftWidth={shaftWidth} />
  );
}
// A line through the origin along getDirection(t), extended to +/- extent
// -- lets you see where the field points even when its arrow is too short
// (or zero-length) to read visually. Reads the shared simTimeRef, same as
// TimeDrivenArrow, and updates the same way ThickArrowHelper's own shaft
// does internally, so it can move every frame once the field becomes
// time-dependent without a React re-render.
function TimeDrivenAxisLine({ simTimeRef, getDirection, extent, color = 'gray', lineWidth = 1.5 }) {
  const lineRef = useRef();
  useFrame(() => {
    const { x, y, z } = getDirection(simTimeRef.current);
    const dir = blochToThree(x, y, z);
    const p0 = dir.clone().multiplyScalar(-extent);
    const p1 = dir.clone().multiplyScalar(extent);
    const line = lineRef.current;
    if (!line) return;
    line.geometry.setPositions([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z]);
    line.computeLineDistances?.();
  });
  return (
    <Line ref={lineRef} points={LINE_PLACEHOLDER_POINTS} color={color} dashed dashSize={0.06} gapSize={0.05} lineWidth={lineWidth} />
  );
}
// Traces the spin's path across the sphere surface over simulated time.
// Points accumulate in a plain array and the whole array is re-handed to
// the <Line> via setPositions whenever a new point is sampled -- simple,
// and plenty fast at the point counts a classroom demo will ever reach. A
// preallocated, drawRange-based buffer would only earn its complexity for
// a much longer-running or denser trace than this needs.
//
// New points are sampled at a fixed *simulated*-time interval, not every
// rendered frame -- sampling every frame would make the trace far denser
// than needed for a smooth curve and would keep growing forever the
// longer the tab stays open. Sampling by simulated time (rather than
// frame count or wall-clock time) also means the trace's visual density
// doesn't change when the speed slider changes -- it reflects how much of
// the trajectory has been traversed, not how long you've been watching.
const TRACE_SAMPLE_INTERVAL = 0.05; // seconds of simulated time between points
const TRACE_MAX_POINTS = 4000;      // safety cap for an unattended long-running tab

function SpinTrace({ simTimeRef, getDirection, speedFactor, resetKey, color = 0xcc0000, visible = true }) {
  const [tracePoints, setTracePoints] = useState([]);
  const lastSampleTime = useRef(-Infinity);

  // Explicit signal, not inferred from t -- catches a reset even when t
  // was already 0 and never numerically "went backward."
  useLayoutEffect(() => {
    lastSampleTime.current = -Infinity;
    setTracePoints([]);
  }, [resetKey]);

  useFrame(() => {
    const t = simTimeRef.current;

    if (t < lastSampleTime.current) {
      lastSampleTime.current = -Infinity;
      setTracePoints([]);
      return;
    }

    if (t - lastSampleTime.current >= TRACE_SAMPLE_INTERVAL / Math.max(1.0, speedFactor)) {
      const { x, y, z } = getDirection(t);
      const p = blochToThree(x, y, z);
      lastSampleTime.current = t;
      setTracePoints((prev) => {
        const next = prev.length >= TRACE_MAX_POINTS ? prev.slice(1) : prev;
        return [...next, [p.x, p.y, p.z]];
      });
    }
  });

  if (tracePoints.length < 2) return null;

  return <Line points={tracePoints} color={color} lineWidth={visible ? 2 : 0} transparent opacity={0.6} />;
}

// Owns the one simulation clock everything time-dependent reads from:
// simTime, a ref incremented here once per frame and never written
// anywhere else. Living inside the Canvas tree as a single component is
// what makes it shareable -- a ref created here can be handed to any
// number of sibling components as an ordinary prop, and they'll all read
// the exact same mutable box every frame. This is also where the rotating-
// frame view will eventually hook in: a <group> wrapping the graticule and
// axis arrows, rotated each frame from this same simTime, so the field,
// the spin, and the frame itself can never disagree about what instant
// they're each showing.
//
// The sidebar's numeric time readout is real React state, but throttled to
// ~10 updates/sec rather than pushed every frame -- a human-readable
// number doesn't need 60 updates/sec the way the arrows' geometry does.
function SimulationScene({ spinState, magneticField, paused, onTimeUpdate, simTimeRef, speedFactor, controlBools, frameAxis, frameOmega }) {
  const lastReportedSec = useRef(-1);

  useFrame((state, delta) => {
    if (!paused) simTimeRef.current += speedFactor * delta;
    const t = simTimeRef.current;
    const rounded = Math.floor(t * 10) / 10;
    if (rounded !== lastReportedSec.current) {
      lastReportedSec.current = rounded;
      onTimeUpdate(rounded);
    }
  });

  const field = {
    ...magneticField,
    mag1: magneticField.rotatingComponent ? magneticField.mag1 : 0,
  };

  const applyFrame = (getDir) => (t) => {
    const raw = getDir(t);
    if (!controlBools.frameRotating) return raw;
    return rotateAroundAxis(raw, frameAxis, frameOmega * t);
  };

  const getSpinDirection = applyFrame((t) => evolveSpin(spinState, field, t));
  const getFieldDirection = applyFrame((t) => fieldDirectionAt(field, t));

  // One canonical key, used both to reset the clock and to tell
  // SpinTrace to clear, since neither can rely on t itself changing:
  // t may already be 0 when a parameter changes (e.g. before Start is ever
  // pressed), and no comparison against a *previous* t can detect that.
  const resetKey = `${spinState.theta}|${spinState.phi}|${magneticField.mag0}|${magneticField.theta0}|${magneticField.phi0}|${magneticField.mag1}|${magneticField.omega1}|${magneticField.phase1}|${magneticField.rotatingComponent}|${frameOmega}|${controlBools.frameRotating}`;

  useLayoutEffect(() => {
    simTimeRef.current = 0;
  }, [resetKey]);

  return (
    <>
      <TimeDrivenArrow simTimeRef={simTimeRef} getDirection={getSpinDirection} length={1} color={0xcc0000} headLength={0.12} headWidth={0.08} shaftWidth={5.0} />
      <SpinTrace simTimeRef={simTimeRef} getDirection={getSpinDirection} speedFactor={speedFactor} visible={controlBools.showSpinTrace} resetKey={resetKey} />
      <TimeDrivenArrow
        simTimeRef={simTimeRef}
        getDirection={getFieldDirection}
        getLength={(t) => fieldMagnitudeAt(field, t) * FIELD_MAGNITUDE_DISPLAY_FACTOR}
        length={field.mag0}
        color={0x0066cc} headLength={0.12} headWidth={0.08} shaftWidth={5.0}
      />
      <TimeDrivenAxisLine simTimeRef={simTimeRef} getDirection={(t) => normalize(getFieldDirection(t))} extent={SPHERE_AXIS_EXTENT} />
    </>
  );
}

// Rotates the "lab frame" backdrop -- sphere, graticule, axis arrows, ket
// labels -- about the static field's axis when the rotating-frame view is
// active. This is the entire implementation of that view: the spin arrow,
// field arrow, and trace keep computing lab-frame directions exactly as
// before, with no awareness a rotating view exists. Rotating the backdrop
// *backward* at the frame's rate produces an identical picture to rotating
// every dynamic object *forward* by the same amount, but touches only
// static geometry instead of every animated component.
function RotatingFrameBackdrop({ simTimeRef, axis, omega, active, children }) {
  const groupRef = useRef();
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    if (!active) {
      group.quaternion.identity();
      return;
    }
    group.quaternion.setFromAxisAngle(axis, omega * simTimeRef.current);
  });
  return <group ref={groupRef}>{children}</group>;
}

function BlochSphere({ spinState, magneticField, paused, setPaused, timeSec, setTimeSec, simTimeRef, speedFactor, setSpeedFactor, controlBools, rotatingFrame }) {
  const controlsRef = useRef();
  // Can't use controls.reset(), since target0/position0 get captured before
  // drei applies the `target` prop below, so reset() would snap to the wrong
  // point. Set both explicitly instead.
  const resetView = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(...SPHERE_INITIAL_CAMERA_POSITION);
    controls.target.set(...SPHERE_INITIAL_CAMERA_TARGET);
    controls.update();
  };

  const equatorXY = useMemo(() => graticuleRing('z'), []);
  const meridianXZ = useMemo(() => graticuleRing('y'), []);
  const meridianYZ = useMemo(() => graticuleRing('x'), []);

  function CameraLight() {
    const lightRef = useRef();
    const { camera } = useThree(); // from '@react-three/fiber'
    useFrame(() => {
      lightRef.current?.position.copy(camera.position);
    });
    return <directionalLight ref={lightRef} intensity={30.0} />;
  }

  //const staticAxisPhysics = unitVectorFromAngles(magneticField.theta0, magneticField.phi0);
  //const frameAxis = blochToThree(staticAxisPhysics.x, staticAxisPhysics.y, staticAxisPhysics.z);
  const frameAxisPhysics = unitVectorFromAngles(magneticField.theta0, magneticField.phi0);
  const frameAxisThree = blochToThree(frameAxisPhysics.x, frameAxisPhysics.y, frameAxisPhysics.z);
  const frameOmega = controlBools.frameLocked
    ? (magneticField.rotatingComponent ? -magneticField.omega1 : magneticField.mag0)
    : rotatingFrame;

  return (
    // position: 'relative' + the button's position: 'absolute' below keeps
    // the button entirely out of the surrounding flex layout -- it overlays
    // the canvas rather than becoming a sibling flex item, so it can't
    // affect the heading/canvas alignment above it.
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: SPHERE_INITIAL_CAMERA_POSITION, fov: 35 }} style={{ width: '100%', height: '100%' }}>
        <ambientLight intensity={5.0} />
        <CameraLight />

        <RotatingFrameBackdrop simTimeRef={simTimeRef} axis={frameAxisThree} omega={frameOmega} active={controlBools.frameRotating}>
          {controlBools.showSphere && (
            <mesh>
              <sphereGeometry args={[1, 32, 32]} />
              <meshStandardMaterial color="gray" transparent opacity={0.25} side={THREE.FrontSide} depthWrite={false} roughness={0.5} metalness={1.00} />
            </mesh>
          )}

          <Line points={equatorXY} color="gray" lineWidth={controlBools.showSphere ? 1 : 0} dashed dashSize={0.06} gapSize={0.05} />
          <Line points={meridianXZ} color="gray" lineWidth={controlBools.showSphere ? 0 : 0} dashed dashSize={0.06} gapSize={0.05} />
          <Line points={meridianYZ} color="gray" lineWidth={controlBools.showSphere ? 0 : 0} dashed dashSize={0.06} gapSize={0.05} />

          <ThickArrowHelper dir={blochToThree(1, 0, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
          <ThickArrowHelper dir={blochToThree(0, 1, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
          <ThickArrowHelper dir={blochToThree(0, 0, 1)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
          <ThickArrowHelper dir={blochToThree(-1, 0, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
          <ThickArrowHelper dir={blochToThree(0, -1, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
          <ThickArrowHelper dir={blochToThree(0, 0, -1)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />

          <KetLabel sign="+" axis="x" position={blochToThree(SPHERE_AXIS_EXTENT + 0.2, 0, 0).toArray()} />
          <KetLabel sign="-" axis="x" position={blochToThree(-(SPHERE_AXIS_EXTENT + 0.2), 0, 0).toArray()} />
          <KetLabel sign="+" axis="y" position={blochToThree(0, SPHERE_AXIS_EXTENT + 0.2, 0).toArray()} />
          <KetLabel sign="-" axis="y" position={blochToThree(0, -(SPHERE_AXIS_EXTENT + 0.2), 0).toArray()} />
          <KetLabel sign="+" axis="z" position={blochToThree(0, 0, SPHERE_AXIS_EXTENT + 0.2).toArray()} />
          <KetLabel sign="-" axis="z" position={blochToThree(0, 0, -(SPHERE_AXIS_EXTENT + 0.2)).toArray()} />
        </RotatingFrameBackdrop>

        <SimulationScene
          spinState={spinState} magneticField={magneticField}
          paused={paused} onTimeUpdate={setTimeSec}
          simTimeRef={simTimeRef} speedFactor={speedFactor}
          frameAxis={frameAxisPhysics} frameOmega={frameOmega}
          controlBools={controlBools}
        />

        <OrbitControls ref={controlsRef} target={SPHERE_INITIAL_CAMERA_TARGET} />
      </Canvas>

      <div className="overlay-controls" style={{ position: 'absolute', top: '10px', right: '10px' }}>
        <h3>Time Controls</h3>
        <label>Time: {timeSec.toFixed(1)} sec</label>
        <div style={{ display: 'flex', flexDirection: 'row' }}>
          <button className="control-button" onClick={() => setPaused((p) => !p)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', margin: 0, fontSize: '1.0rem', width: '100px' }}>
            {paused ? <PlayIcon /> : <PauseIcon />}
            {paused ? 'Start' : 'Pause'}
          </button>
          <button className="control-button" onClick={() => { simTimeRef.current = 0; }} style={{ marginLeft: '6px', padding: '6px 14px', fontSize: '1.0rem', width: '100px' }}>
            Reset
          </button>
        </div>
        <div className="control-group" style={{ margin: '8px 0px' }}>
          <label>Speed: {speedFactor.toFixed(1)}×</label>
          <input
            type="range" min={0.1} max={2.0} step={0.1}
            value={speedFactor}
            onChange={(e) => setSpeedFactor(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <button
        className="control-button"
        onClick={resetView}
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          width: '60px',
          height: '60px',
          padding: '2px',
          margin: 0,
          fontSize: '0.8rem',
          lineHeight: 1.15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        Reset View
      </button>
    </div>
  );
}

export default function App() {
  const [controlBools, setControlBools] = useState({
    frameRotating: false,
    frameLocked: false,
    showSphere: true,
    showSpinTrace: true
  });
  // Spin state at t = 0, set by two angles
  const [initialSpinState, setInitialSpinState] = useState({ theta: 0, phi: 0 });
  // Every element of this array should have a theta, phi, magnitude, omega, and phase (at t=0) specifying it
  const [magneticField, setMagneticField] = useState({ mag0: 1, theta0: 0, phi0: 0, mag1: 0, omega1: 0, phase1: 0, rotatingComponent: false });
  // Rotating frame properties
  const [rotatingFrame, setRotatingFrame] = useState(0); // The value is the rad/s omega of the rotating frame
  // Pausing the animation
  const [paused, setPaused] = useState(true);
  // Time variable
  const [timeSec, setTimeSec] = useState(0);
  const simTime = useRef(0);
  // Animation speed factor
  const [speedFactor, setSpeedFactor] = useState(1);

  // For setting just one property of a magnetic field
  // Usage example: updateField({ theta: parseFloat(e.target.value) })
  function updateField(patch) {
    //simTime.current = 0;
    setMagneticField(prev => ({ ...prev, ...patch }));
  }
  function updateSpinState(patch) {
    //simTime.current = 0;
    setInitialSpinState(prev => ({ ...prev, ...patch }));
  }

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        {/*<SpherePanel controlBools={controlBools} />*/}
        <BlochSphere
          spinState={initialSpinState} magneticField={magneticField}
          paused={paused} setPaused={setPaused}
          timeSec={timeSec} setTimeSec={setTimeSec}
          simTimeRef={simTime}
          speedFactor={speedFactor} setSpeedFactor={setSpeedFactor}
          controlBools={controlBools} rotatingFrame={rotatingFrame}
        />
      </div>

      {/* Right Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-content">
          <div className="panel-controls">
            <div>
              <h3>Spin State at t = 0</h3>
              <div className="control-group">
                <SliderPlusTextboxControl
                  label="θ (degrees)"
                  valueNum={(initialSpinState.theta * 180 / Math.PI).toFixed(1)}
                  onChangeNum={(val) => updateSpinState({ theta: val*Math.PI/180 })}
                  min={0.0}
                  max={180.0}
                  step={1.0}
                />
                <SliderPlusTextboxControl
                  label="φ (degrees)"
                  valueNum={(initialSpinState.phi * 180 / Math.PI).toFixed(1)}
                  onChangeNum={(val) => updateSpinState({ phi: val*Math.PI/180 })}
                  min={-180.0}
                  max={180.0}
                  step={1.0}
                />
              </div>

              <hr className="sidebar-divider" />
              
              <h3>Magnetic Field</h3>
              <div className="control-group">
                <SliderPlusTextboxControl label="θ (°)" valueNum={(magneticField.theta0 * 180 / Math.PI).toFixed(1)} onChangeNum={(val) => updateField({ theta0: val * Math.PI / 180 })} min={0.0} max={180.0} step={1.0} />
                <SliderPlusTextboxControl label="φ (°)" valueNum={(magneticField.phi0 * 180 / Math.PI).toFixed(1)} onChangeNum={(val) => updateField({ phi0: val * Math.PI / 180 })} min={-180.0} max={180.0} step={1.0} />
                <SliderPlusTextboxControl label="Mag." valueNum={magneticField.mag0.toFixed(1)} onChangeNum={(val) => updateField({ mag0: val })} min={0.0} max={5.0} step={0.1} />
                <div className="control-group" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', marginTop: '0.25em' }}>
                  <h6 style={{ margin: 0 }}>Transverse Rotating Component</h6>
                  <input
                    type="checkbox"
                    checked={magneticField.rotatingComponent}
                    onChange={(e) => updateField({ rotatingComponent: e.target.checked })}
                  />
                </div>
                {magneticField.rotatingComponent && (
                  <div className="control-group">
                    <SliderPlusTextboxControl
                      label="Mag."
                      valueNum={magneticField.mag1.toFixed(1)}
                      onChangeNum={(val) => updateField({ mag1: val })}
                      min={0.0} max={10.0} step={0.1}
                    />
                    <SliderPlusTextboxControl
                      label="ω (rad/s)"
                      valueNum={magneticField.omega1.toFixed(1)}
                      onChangeNum={(val) => updateField({ omega1: val })}
                      min={-10.0} max={10.0} step={0.1}
                    />
                    <SliderPlusTextboxControl
                      label="φ(t=0) (°)"
                      valueNum={(magneticField.phase1 * 180 / Math.PI).toFixed(1)}
                      onChangeNum={(val) => updateField({ phase1: val * Math.PI / 180 })}
                      min={-180.0} max={180.0} step={1.0}
                    />
                  </div>
                )}
              </div>

              <hr className="sidebar-divider" />

              <h3>Rotating Frame</h3>
              <div className="control-group">
                <label>
                  <input type="checkbox" checked={controlBools.frameRotating} onChange={(e) => setControlBools({ ...controlBools, frameRotating: e.target.checked })} />
                  Enable rotating frame
                </label>
                {controlBools.frameRotating &&
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={controlBools.frameLocked}
                        disabled={!magneticField.rotatingComponent}
                        onChange={(e) => setControlBools({ ...controlBools, frameLocked: e.target.checked })}
                      />
                      Lock rotation to B-field
                    </label>
                    <SliderPlusTextboxControl
                      label="Frame ω (rad/s)"
                      valueNum={rotatingFrame.toFixed(1)}
                      onChangeNum={(val) => setRotatingFrame(val)}
                      min={-10.0} max={10.0} step={0.1}
                      disabled={!controlBools.frameRotating || controlBools.frameLocked}
                    />
                  </>
                }
              </div>

              <hr className="sidebar-divider" />

              <h3>Display Options</h3>
              <div className="control-group" style={{ gap: '0px' }}>
                <label>
                  <input type="checkbox" checked={controlBools.showSphere} onChange={(e) => setControlBools({ ...controlBools, showSphere: e.target.checked })} />
                  Show sphere
                </label>
                <label>
                  <input type="checkbox" checked={controlBools.showSpinTrace} onChange={(e) => setControlBools({ ...controlBools, showSpinTrace: e.target.checked })} />
                  Show path of spin vector
                </label>
              </div>

              {/*
              <div className="control-group" style={{ marginTop: '1.0em' }}>
                <button className={`control-button ${controlBools.advancedBField ? 'active-special' : ''}`} onClick={() => setControlBools({ ...controlBools, advancedBField: !controlBools.advancedBField })}>
                  Advanced
                </button>
              </div>
              */}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}