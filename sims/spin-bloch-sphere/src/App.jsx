import React, { useRef, useEffect, useMemo, useState } from 'react';
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
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
    <Line ref={lineRef} points={[[0, 0, 0], [0, 0, 0.001]]} color={color} dashed dashSize={0.06} gapSize={0.05} lineWidth={lineWidth} />
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

function SpinTrace({ simTimeRef, getDirection, resetKey, color = 0xcc0000 }) {
  const lineRef = useRef();
  const points = useRef([]);
  const lastSampleTime = useRef(-Infinity);

  // Any change to the trajectory's defining parameters (resetKey) means
  // the trace drawn so far describes a different, no-longer-current
  // trajectory -- clear it rather than mixing stale segments from a
  // previous setup in with new ones.
  useEffect(() => {
    points.current = [];
    lastSampleTime.current = -Infinity;
    lineRef.current?.geometry.setPositions([0, 0, 0, 0, 0, 0.001]);
  }, [resetKey]);

  useFrame(() => {
    const t = simTimeRef.current;

    // Time running backwards means the clock was just reset via the
    // Reset button -- start the trace over rather than drawing a line
    // back to wherever it left off.
    if (t < lastSampleTime.current) {
      points.current = [];
      lastSampleTime.current = -Infinity;
    }

    if (t - lastSampleTime.current >= TRACE_SAMPLE_INTERVAL) {
      const { x, y, z } = getDirection(t);
      const p = blochToThree(x, y, z);
      points.current.push(p.x, p.y, p.z);
      if (points.current.length > TRACE_MAX_POINTS * 3) {
        points.current.splice(0, points.current.length - TRACE_MAX_POINTS * 3);
      }
      lastSampleTime.current = t;
      lineRef.current?.geometry.setPositions(points.current);
    }
  });

  return (
    <Line ref={lineRef} points={[[0, 0, 0], [0, 0, 0.001]]} color={color} lineWidth={2} transparent opacity={0.6} />
  );
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
function SimulationScene({ spinState, magneticField, paused, onTimeUpdate, simTimeRef, speedFactor }) {
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

  const field = magneticField[0];
  const getSpinDirection = (t) => {
    const s0 = unitVectorFromAngles(spinState.theta, spinState.phi);
    const bHat = unitVectorFromAngles(field.theta, field.phi);
    return rotateAroundAxis(s0, bHat, -field.mag * t);
  };

  return (
    <>
      {/* Spin arrow */}
      <TimeDrivenArrow simTimeRef={simTimeRef} getDirection={getSpinDirection} length={1} color={0xcc0000} headLength={0.12} headWidth={0.08} shaftWidth={5.0} />
      <SpinTrace
        simTimeRef={simTimeRef}
        getDirection={getSpinDirection}
        resetKey={`${spinState.theta}|${spinState.phi}|${field.theta}|${field.phi}|${field.mag}`}
      />
      {/* B-field arrow + line */}
      <TimeDrivenArrow
        simTimeRef={simTimeRef}
        getDirection={(t) => unitVectorFromAngles(field.theta, field.phi)}
        getLength={(t) => field.mag*FIELD_MAGNITUDE_DISPLAY_FACTOR}
        length={field.mag}
        color={0x0066cc} headLength={0.12} headWidth={0.08} shaftWidth={5.0}
      />
      <TimeDrivenAxisLine
        simTimeRef={simTimeRef}
        getDirection={(t) => unitVectorFromAngles(field.theta, field.phi)}
        extent={SPHERE_AXIS_EXTENT} color={0x0066cc}
      />
    </>
  );
}

function BlochSphere({ spinState, magneticField, paused, setPaused, timeSec, setTimeSec, simTimeRef, speedFactor, setSpeedFactor, controlBools }) {
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

  return (
    // position: 'relative' + the button's position: 'absolute' below keeps
    // the button entirely out of the surrounding flex layout -- it overlays
    // the canvas rather than becoming a sibling flex item, so it can't
    // affect the heading/canvas alignment above it.
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: SPHERE_INITIAL_CAMERA_POSITION, fov: 35 }} style={{ width: '100%', height: '100%' }}>
        {controlBools.showSphere ? 
          (
          <>
            <ambientLight intensity={5.0} />
            <CameraLight />
            <mesh>
              <sphereGeometry args={[1, 32, 32]} />
              <meshStandardMaterial color="gray" transparent opacity={0.25} side={THREE.FrontSide} depthWrite={false} roughness={0.5} metalness={1.00} />
            </mesh>
          </>
          ) : 
          (null)
        }

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

        <SimulationScene
          spinState={spinState} magneticField={magneticField}
          paused={paused} onTimeUpdate={setTimeSec}
          simTimeRef={simTimeRef} speedFactor={speedFactor}
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
        <div className="control-group" style={{ marginTop: '8px' }}>
          <label>Speed: {speedFactor.toFixed(1)}×</label>
          <input
            type="range" min={0.1} max={5} step={0.1}
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
    showSphere: true,             // Displaying the sphere
    advancedBField: false         // For when the user is specifying an advanced magnetic field
  });
  // Spin state at t = 0, set by two angles
  const [initialSpinState, setInitialSpinState] = useState({ theta: 0, phi: 0 });
  // Every element of this array should have a theta, phi, magnitude, omega, and phase (at t=0) specifying it
  const [magneticField, setMagneticField] = useState([{ mag: 1, theta: 0, phi: 0, omega: 0, phase: 0 }]);
  // Pausing the animation
  const [paused, setPaused] = useState(true);
  // Time variable
  const [timeSec, setTimeSec] = useState(0);
  const simTime = useRef(0);
  // Animation speed factor
  const [speedFactor, setSpeedFactor] = useState(1);

  // For setting just one property of one component of a magnetic field
  // Usage example: updateFieldComponent(0, { theta: parseFloat(e.target.value) })
  function updateFieldComponent(index, patch) {
    setMagneticField(prev => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  // For adding and removing components of a magnetic field
  const addFieldComponent = () =>
    setMagneticField(prev => [...prev, { mag: 1, theta: 0, phi: 0, omega: 0 }]);
  const removeFieldComponent = (index) =>
    setMagneticField(prev => prev.filter((_, i) => i !== index));

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
          controlBools={controlBools}
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
                  onChangeNum={(val) => {setInitialSpinState({ ...initialSpinState, theta: val*Math.PI/180 })}}
                  min={0.0}
                  max={180.0}
                  step={1.0}
                />
                <SliderPlusTextboxControl
                  label="φ (degrees)"
                  valueNum={(initialSpinState.phi * 180 / Math.PI).toFixed(1)}
                  onChangeNum={(val) => {setInitialSpinState({ ...initialSpinState, phi: val*Math.PI/180 })}}
                  min={-180.0}
                  max={180.0}
                  step={1.0}
                />
              </div>

              <hr className="sidebar-divider" />
              
              <h3>Magnetic Field</h3>

              <div className="control-group">
                <SliderPlusTextboxControl
                  label="θ (degrees)"
                  valueNum={(magneticField[0].theta * 180 / Math.PI).toFixed(1)}
                  onChangeNum={(val) => {updateFieldComponent(0, { theta: parseFloat(val*Math.PI/180) })}}
                  min={0.0}
                  max={180.0}
                  step={1.0}
                />
                <SliderPlusTextboxControl
                  label="φ (degrees)"
                  valueNum={(magneticField[0].phi * 180 / Math.PI).toFixed(1)}
                  onChangeNum={(val) => {updateFieldComponent(0, { phi: parseFloat(val*Math.PI/180) })}}
                  min={-180.0}
                  max={180.0}
                  step={1.0}
                />
                <SliderPlusTextboxControl
                  label="|B|"
                  valueNum={(magneticField[0].mag).toFixed(1)}
                  onChangeNum={(val) => {updateFieldComponent(0, { mag: parseFloat(val) })}}
                  min={0.0}
                  max={10.0}
                  step={0.1}
                />
              </div>

              <hr className="sidebar-divider" />

              <h3>Display Options</h3>
              <div className="control-group">
                <label style={{ margin: '0 0 4px 0' }}>
                  <input type="checkbox" checked={controlBools.showSphere} onChange={(e) => setControlBools({ ...controlBools, showSphere: e.target.checked })} />
                  Show sphere
                </label>
              </div>

              <div className="control-group" style={{ marginTop: '1.0em' }}>
                <button className={`control-button ${controlBools.advancedBField ? 'active-special' : ''}`} onClick={() => setControlBools({ ...controlBools, advancedBField: !controlBools.advancedBField })}>
                  Advanced
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}