import React, { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import ThickArrowHelper from './ThickArrowHelper.jsx';
import { ketWidth, drawKet } from './ket.js';
import Histogram from './Histogram.jsx';
import * as THREE from 'three';
import './App.css';

/********** Constants and initial values **********/
const SPHERE_INITIAL_CAMERA_POSITION = [3.6, 2.0, -3.6];
const SPHERE_INITIAL_CAMERA_TARGET = [0, 0.15, 0];
const SPHERE_AXIS_EXTENT = 1.3;  // Helps determine how far axis arrows and axis labels are drawn beyond the sphere itself
const SPHERE_AXIS_LABEL_EXTENT = 0.15;

const DATA_COLLECTION_CAMERA_PAN = [-0.36, 0, -0.36];

const FIELD_MAGNITUDE_DISPLAY_FACTOR = 0.5;

// A stable placeholder array for <Line> refs that get updated through imperative handles
const LINE_PLACEHOLDER_POINTS = [[0, 0, 0], [0, 0, 0.001]];

const AXIS_TICK_HALF_ANGLE = 0.05; // radians each arm reaches from center

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

function magnitude(v) { return Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2); }

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

// The field actually driving the evolution -- the rotating component only
// contributes once explicitly enabled, otherwise its magnitude is masked to
// zero. Shared by the live animation (SimulationScene) and the data-
// collection trial math below, so the two can't silently diverge on what
// "the field in effect" means.
function activeField(field) {
  return { ...field, mag1: field.rotatingComponent ? field.mag1 : 0 };
}

// The "+1" eigenstate direction for a measurement along a given axis.
function axisUnitVector(axis) {
  switch (axis) {
    case 'x': return { x: 1, y: 0, z: 0 };
    case 'y': return { x: 0, y: 1, z: 0 };
    case 'z':
    default: return { x: 0, y: 0, z: 1 };
  }
}

function projectParallelPerp(v, axisUnit) {
  const d = dot(v, axisUnit);
  const parallel = { x: axisUnit.x * d, y: axisUnit.y * d, z: axisUnit.z * d };
  const perp = { x: v.x - parallel.x, y: v.y - parallel.y, z: v.z - parallel.z };
  return { parallel, perp };
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// Only seeds the very first basis, before there's a previous e1 to carry
// forward from.
function arbitraryPerpendicular(n) {
  const helper = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  return normalize(projectParallelPerp(helper, n).perp);
}

// The rotating component's phase-zero direction (e1) and its partner (e2),
// carried forward from the *previous* basis by re-orthogonalizing against
// the *new* n, instead of recomputed from n alone by a fixed formula.
//
// No formula f(n) -> e1 can be continuous over the whole sphere (hairy
// ball theorem) -- that's why every earlier version (hard-coded fallback,
// Frisvad's construction, a wider or narrower margin) had a seam
// somewhere, and why moving the seam never shrank the jump: at the seam,
// the formula's two sides just disagree, by the same amount regardless of
// where you put it.
//
// theta0/phi0 never actually sweep the whole sphere in one step, though --
// they move by one slider tick at a time. So instead of "what's e1 as a
// function of n," this asks "what's e1 now, given what it was a moment
// ago": project the old e1 back into the plane perpendicular to the new n
// and renormalize. A small step in n produces a small correction to e1 --
// no seam anywhere near the path actually being drawn. The only way to
// hit trouble is if n jumps by something like 90 degrees in one update,
// which a slider never does.
function advanceTransverseBasis(prevBasis, n) {
  const { perp } = projectParallelPerp(prevBasis.e1, n);
  const mag = magnitude(perp);
  const e1 = mag > 1e-6
    ? { x: perp.x / mag, y: perp.y / mag, z: perp.z / mag }
    : arbitraryPerpendicular(n);
  const e2 = cross(n, e1);
  return { n, e1, e2 };
}

// How far the static axis needs to be from the pole before the *total*
// field (static part plus a circle of radius mag1 around it) could
// plausibly reach near-polar territory -- see transverseBasis.
function fieldMargin(field) {
  return Math.max(1e-7, Math.atan2(Math.abs(field.mag1), Math.max(field.mag0, 1e-6)));
}

// The field's static and rotating pieces, computed separately -- shared by
// fieldDirectionAt (which just sums them) and the "static/rotating parts"
// component display, so there's one definition instead of two.
function fieldPartsAt(field, t, basisRef) {
  const { n, e1, e2 } = basisRef.current;
  const Phi = field.omega1 * t + field.phase1;
  const staticPart = { x: field.mag0 * n.x, y: field.mag0 * n.y, z: field.mag0 * n.z };
  const rotatingPart = {
    x: field.mag1 * (Math.cos(Phi) * e1.x + Math.sin(Phi) * e2.x),
    y: field.mag1 * (Math.cos(Phi) * e1.y + Math.sin(Phi) * e2.y),
    z: field.mag1 * (Math.cos(Phi) * e1.z + Math.sin(Phi) * e2.z),
  };
  return { staticPart, rotatingPart };
}

function fieldDirectionAt(field, t, basisRef) {
  const { staticPart, rotatingPart } = fieldPartsAt(field, t, basisRef);
  return { x: staticPart.x + rotatingPart.x, y: staticPart.y + rotatingPart.y, z: staticPart.z + rotatingPart.z };
}

function fieldMagnitudeAt(field, t, basisRef) {
  const { x, y, z } = fieldDirectionAt(field, t, basisRef);
  return Math.sqrt(x * x + y * y + z * z);
}

// The time-independent effective field in the frame co-rotating with the
// drive -- the exact b_eff evolveSpin already precesses the spin about.
// Pulled out on its own so the "Effective field" component display shows
// literally the object the physics is built from, not a re-derived copy.
function effectiveField(field, basisRef) {
  const { n, e1 } = basisRef.current;
  return {
    x: (field.mag0 + field.omega1) * n.x + field.mag1 * e1.x,
    y: (field.mag0 + field.omega1) * n.y + field.mag1 * e1.y,
    z: (field.mag0 + field.omega1) * n.z + field.mag1 * e1.z,
  };
}

// Exact solution for a static field plus one transverse-rotating
// component sharing the static field's axis: transform into the frame
// co-rotating with the drive (field looks static there), precess about
// the resulting fixed effective field, then rotate back to the lab frame.
function evolveSpin(spinState, field, t, basisRef) {
  const { n } = basisRef.current;
  const Phi = field.omega1 * t + field.phase1;

  const beff = effectiveField(field, basisRef);
  const omegaEff = Math.sqrt(beff.x ** 2 + beff.y ** 2 + beff.z ** 2);

  const s0 = unitVectorFromAngles(spinState.theta, spinState.phi);
  const intoRotatingFrame = rotateAroundAxis(s0, n, -field.phase1);
  const precessed = omegaEff < 1e-9
    ? intoRotatingFrame
    : rotateAroundAxis(intoRotatingFrame, normalize(beff), omegaEff * t);

  return rotateAroundAxis(precessed, n, Phi);
}

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

function getFieldComponentArrows(mode, field, spinState, basisRef) {
  switch (mode) {
    case 'xyz':
      return [
        { color: 0xff9900, getDirection: (t) => { const b = fieldDirectionAt(field, t, basisRef); return { x: b.x, y: 0, z: 0 }; } },
        { color: 0x33cc33, getDirection: (t) => { const b = fieldDirectionAt(field, t, basisRef); return { x: 0, y: b.y, z: 0 }; } },
        { color: 0x9933ff, getDirection: (t) => { const b = fieldDirectionAt(field, t, basisRef); return { x: 0, y: 0, z: b.z }; } },
      ];
    case 'staticAxis':
      return [
        { color: 0xff9900, getDirection: (t) => projectParallelPerp(fieldDirectionAt(field, t, basisRef), basisRef.current.n).parallel },
        { color: 0x9933ff, getDirection: (t) => projectParallelPerp(fieldDirectionAt(field, t, basisRef), basisRef.current.n).perp },
      ];
    case 'spin':
      return [
        { color: 0xff9900, getDirection: (t) => projectParallelPerp(fieldDirectionAt(field, t, basisRef), evolveSpin(spinState, field, t, basisRef)).parallel },
        { color: 0x9933ff, getDirection: (t) => projectParallelPerp(fieldDirectionAt(field, t, basisRef), evolveSpin(spinState, field, t, basisRef)).perp },
      ];
    case 'effectiveField':
      return [{
        color: 0x00cccc,
        getDirection: (t) => {
          const { n } = basisRef.current;
          const beff = effectiveField(field, basisRef);
          return rotateAroundAxis(beff, n, field.omega1 * t + field.phase1);
        },
      }];
    case 'none':
    default:
      return [];
  }
}

// A "|+>_x"-style ket, drawn with ket.js onto a small canvas rather than
// as text, so it shares the exact same bracket geometry as every other ket
// in the app (the sphere's own pole labels, the histogram's bar labels)
// instead of drifting from them the way a font-rendered "|+>" would. Used
// below as the icon on each axis-eigenstate preset button.
function KetIcon({ sign, axis, size = 24 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const ketSize = size * 0.55;
    const kWidth = ketWidth(ketSize);
    const subPx = ketSize * 0.55;
    ctx.font = `bold ${subPx}px sans-serif`;
    const subWidth = ctx.measureText(axis).width;
    const gap = -ketSize * 0.06;
    const totalWidth = kWidth + gap + subWidth;
    const startX = (size - totalWidth) / 2;
    const midY = size / 2;

    ctx.fillStyle = '#333333';
    drawKet(ctx, startX, midY, ketSize, sign);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(axis, startX + kWidth + gap, midY + ketSize * 0.28);
  }, [sign, axis, size]);

  return <canvas ref={canvasRef} style={{ display: 'block' }} />;
}

// The six eigenstates of X, Y, and Z -- theta/phi for each, matching the
// same unitVectorFromAngles convention used everywhere else (theta from
// +z, phi from +x toward +y).
const AXIS_EIGENSTATES = [
  { sign: '+', axis: 'x', theta: Math.PI / 2, phi: 0 },
  { sign: '-', axis: 'x', theta: Math.PI / 2, phi: Math.PI },
  { sign: '+', axis: 'y', theta: Math.PI / 2, phi: Math.PI / 2 },
  { sign: '-', axis: 'y', theta: Math.PI / 2, phi: -Math.PI / 2 },
  { sign: '+', axis: 'z', theta: 0, phi: 0 },
  { sign: '-', axis: 'z', theta: Math.PI, phi: 0 },
];

// A compact single-row substitute for a full row of X/Y/Z buttons plus its
// own label line above them -- adapted from the Stern-Gerlach sim's
// AxisStepper (same up/down-stepper-through-a-fixed-list idea, same CSS
// classes), simplified since there's always exactly one stepper here (not
// one per SG) and only the three axis names to cycle through, never an
// "advanced" angle-entry mode.
const MEASUREMENT_AXES = ['x', 'y', 'z'];

function MeasurementAxisStepper({ axis, setAxis, disabled, label }) {
  const currentIndex = MEASUREMENT_AXES.indexOf(axis);
  const step = (delta) => {
    const nextIndex = (currentIndex + delta + MEASUREMENT_AXES.length) % MEASUREMENT_AXES.length;
    setAxis(MEASUREMENT_AXES[nextIndex]);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
      <label style={{ margin: 0, fontSize: '13px' }}>{label}</label>
      <div className="axis-stepper">
        <span className={`axis-stepper-value ${disabled ? 'disabled' : ''}`}>{axis.toUpperCase()}</span>
        <div className="axis-stepper-arrows">
          <button type="button" className="axis-stepper-arrow" onClick={() => step(1)} aria-label="Next axis" disabled={disabled}>▲</button>
          <button type="button" className="axis-stepper-arrow" onClick={() => step(-1)} aria-label="Previous axis" disabled={disabled}>▼</button>
        </div>
      </div>
    </div>
  );
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
// Both generate points mapped through blochToThree, radius 1 -- so every
// curve on the sphere shares the exact same physics-to-scene transform as
// the state arrow and the axis lines, rather than each needing its own
// hand-derived sign. More segments = smoother-looking ring.

// A latitude line (parallel): fixed polar angle theta, sweeping the
// azimuth phi through a full circle. theta = pi/2 is the equator.
function graticuleParallel(theta, segments = 96) {
  const pts = [];
  const s0 = Math.sin(theta), c0 = Math.cos(theta);
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(blochToThree(s0 * Math.cos(t), s0 * Math.sin(t), c0));
  }
  return pts;
}

// A longitude line (meridian): the full great circle through both poles at
// a fixed azimuth phi (and, on the far side, phi + pi -- the same great
// circle passes through both). Parametrized directly in that vertical
// plane rather than by sweeping theta 0..2*pi, since theta beyond its
// usual 0..pi range doesn't trace the far side the way this does.
function graticuleMeridian(phi, segments = 96) {
  const pts = [];
  const cp = Math.cos(phi), sp = Math.sin(phi);
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push(blochToThree(c * cp, c * sp, s));
  }
  return pts;
}

// A short segment of one of graticuleRing's own great circles, centered on
// angle centerT -- used below to draw "+" tick marks that actually lie on
// the sphere (sharing graticuleRing's exact parametrization, not a flat
// billboarded glyph), so their curvature reads as real surface geometry
// rather than a 2D icon floating in front of it.
function graticuleArc(fixedAxis, centerT, halfAngle, segments = 8) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = centerT - halfAngle + (2 * halfAngle) * (i / segments);
    const c = Math.cos(t), s = Math.sin(t);
    if (fixedAxis === 'z') pts.push(blochToThree(c, s, 0));
    else if (fixedAxis === 'y') pts.push(blochToThree(c, 0, s));
    else pts.push(blochToThree(0, c, s));
  }
  return pts;
}

// A small "+" mark on the sphere's surface at each of the six points where
// the axis arrows pierce it -- each arm is a short arc of whichever
// graticule ring already passes through that point (two rings cross at
// every axis point, giving two arms at right angles). AXIS_TICK_HALF_ANGLE
// controls each arm's length; keeping it well under the ring's own segment
// spacing near these points is why a coarser 8-segment arc still looks
// smooth despite the full rings using 96.
function axisSurfaceTicks(halfAngle = AXIS_TICK_HALF_ANGLE) {
  const arms = [
    ['z', 0], ['y', 0],                       // +x
    ['z', Math.PI], ['y', Math.PI],           // -x
    ['z', Math.PI / 2], ['x', 0],             // +y
    ['z', -Math.PI / 2], ['x', Math.PI],      // -y
    ['y', Math.PI / 2], ['x', Math.PI / 2],   // +z
    ['y', -Math.PI / 2], ['x', -Math.PI / 2], // -z
  ];
  return arms.map(([ring, t]) => graticuleArc(ring, t, halfAngle));
}

// A ring's points, expanded into a flat sequence of 2-point segments --
// [P0,P1, P1,P2, P2,P3, ...]. Paired with <Line segments> below (backed by
// three's LineSegments2/LineSegmentsGeometry rather than the connected
// Line2), each pair renders as its own independent edge with no implicit
// connection to its neighbors. That's what lets GraticuleRing hide
// individual segments -- by collapsing just that one pair to a repeated
// point -- without a stray line ever bridging across a hidden gap to
// whatever segment happens to be visible next, the way collapsing a
// *connected* strip's shared vertices would.
function ringToSegmentPairs(points) {
  const pairs = [];
  for (let i = 0; i < points.length - 1; i++) {
    pairs.push(points[i], points[i + 1]);
  }
  return pairs;
}

// One latitude or longitude ring, split live into a solid arc (the half
// facing the camera) and a dashed arc (the half facing away) -- the same
// "hidden line" convention technical drawings use for edges a solid
// surface would actually block. Rebuilt every frame because "facing the
// camera" depends on the live camera position (orbiting) and, when the
// rotating-frame view is active, on the backdrop's own live rotation too.
function GraticuleRing({ points }) {
  const anchorRef = useRef();
  const solidRef = useRef();
  const dashedRef = useRef();
  const { camera } = useThree();

  // Precomputed once per ring (points is stable unless latCount/lonCount
  // change) -- only the per-segment visibility below needs to run every
  // frame, not this expansion.
  const segmentPairs = useMemo(() => ringToSegmentPairs(points), [points]);
  const placeholder = useMemo(
    () => segmentPairs.map(() => [0, 0, 0]),
    [segmentPairs]
  );

  useFrame(() => {
    const anchor = anchorRef.current;
    const solid = solidRef.current;
    const dashed = dashedRef.current;
    if (!anchor || !solid || !dashed) return;

    // worldToLocal folds in every ancestor transform -- including the
    // rotating-frame backdrop's own live spin -- so "front" vs "back" is
    // judged against how things actually look this frame, not the
    // un-rotated rest pose. updateWorldMatrix guards against reading a
    // stale matrix if this runs before the backdrop group's own useFrame
    // has updated its rotation for the current frame.
    anchor.updateWorldMatrix(true, false);
    const localCam = anchor.worldToLocal(camera.position.clone());

    const solidPositions = new Array(segmentPairs.length * 3);
    const dashedPositions = new Array(segmentPairs.length * 3);
    for (let i = 0; i < segmentPairs.length; i += 2) {
      const a = segmentPairs[i];
      const b = segmentPairs[i + 1];
      const front = (a.x + b.x) * localCam.x + (a.y + b.y) * localCam.y + (a.z + b.z) * localCam.z > 0;
      const [sa, sb] = front ? [a, b] : [a, a];
      const [da, db] = front ? [a, a] : [a, b];
      solidPositions[i * 3] = sa.x; solidPositions[i * 3 + 1] = sa.y; solidPositions[i * 3 + 2] = sa.z;
      solidPositions[i * 3 + 3] = sb.x; solidPositions[i * 3 + 4] = sb.y; solidPositions[i * 3 + 5] = sb.z;
      dashedPositions[i * 3] = da.x; dashedPositions[i * 3 + 1] = da.y; dashedPositions[i * 3 + 2] = da.z;
      dashedPositions[i * 3 + 3] = db.x; dashedPositions[i * 3 + 4] = db.y; dashedPositions[i * 3 + 5] = db.z;
    }
    solid.geometry.setPositions(solidPositions);
    dashed.geometry.setPositions(dashedPositions);
    dashed.computeLineDistances?.();
  });

  return (
    <group ref={anchorRef}>
      <Line ref={solidRef} points={placeholder} color="#bbb" lineWidth={1} segments />
      <Line ref={dashedRef} points={placeholder} color="#eee" lineWidth={1} segments dashed dashSize={0.06} gapSize={0.05} />
    </group>
  );
}

// The full graticule: latCount evenly-spaced latitude lines between the
// poles, plus lonCount evenly-spaced longitude lines around them (a
// longitude ring already traces both its phi and phi+pi sides -- see
// graticuleMeridian -- so only phi in [0, pi) is needed to cover every
// unique one).
function GraticuleLines({ latCount, lonCount, segments = 96 }) {
  const rings = useMemo(() => {
    const result = [];
    for (let i = 0; i < latCount; i++) {
      const theta = ((i + 1) / (latCount + 1)) * Math.PI;
      result.push({ key: `lat${i}`, points: graticuleParallel(theta, segments) });
    }
    for (let i = 0; i < lonCount; i++) {
      const phi = (i / lonCount) * Math.PI;
      result.push({ key: `lon${i}`, points: graticuleMeridian(phi, segments) });
    }
    return result;
  }, [latCount, lonCount, segments]);

  return rings.map((ring) => <GraticuleRing key={ring.key} points={ring.points} />);
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

// The on-screen tip position of a physics-space direction function --
// blochToThree is an isometry, so a vector's display tip is just its
// blochToThree image scaled by the same display factor used for arrow
// lengths, without separately normalizing and rescaling by magnitude.
function tipPoint(getDirection) {
  return (t) => {
    const v = getDirection(t);
    return blochToThree(v.x, v.y, v.z).multiplyScalar(FIELD_MAGNITUDE_DISPLAY_FACTOR);
  };
}

// A dashed line between two points, each recomputed every frame.
// getPointA/getPointB return THREE.Vector3s already in display
// coordinates (post blochToThree, post any frame transform) -- generic
// enough to connect a component tip to the field tip, or to connect the
// X/Y/Z box-projection points below.
function DashedConnector({ simTimeRef, getPointA, getPointB, color = 0x999999 }) {
  const lineRef = useRef();
  useFrame(() => {
    const t = simTimeRef.current;
    const a = getPointA(t);
    const b = getPointB(t);
    const line = lineRef.current;
    if (!line) return;
    line.geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
    line.computeLineDistances?.();
  });
  return <Line ref={lineRef} points={LINE_PLACEHOLDER_POINTS} color={color} dashed dashSize={0.04} gapSize={0.03} lineWidth={1} />;
}
function XYZBoxConnectors({ simTimeRef, tipB, tipX, tipY, tipZ }) {
  const projXY = (t) => tipX(t).add(tipY(t));
  const projXZ = (t) => tipX(t).add(tipZ(t));
  const projYZ = (t) => tipY(t).add(tipZ(t));

  return (
    <>
      <DashedConnector simTimeRef={simTimeRef} getPointA={tipB} getPointB={projXY} />
      <DashedConnector simTimeRef={simTimeRef} getPointA={tipB} getPointB={projXZ} />
      <DashedConnector simTimeRef={simTimeRef} getPointA={tipB} getPointB={projYZ} />
      <DashedConnector simTimeRef={simTimeRef} getPointA={projXY} getPointB={tipX} />
      <DashedConnector simTimeRef={simTimeRef} getPointA={projXY} getPointB={tipY} />
      <DashedConnector simTimeRef={simTimeRef} getPointA={projXZ} getPointB={tipX} />
      <DashedConnector simTimeRef={simTimeRef} getPointA={projXZ} getPointB={tipZ} />
      <DashedConnector simTimeRef={simTimeRef} getPointA={projYZ} getPointB={tipY} />
      <DashedConnector simTimeRef={simTimeRef} getPointA={projYZ} getPointB={tipZ} />
    </>
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
function SimulationScene({ spinState, magneticField, paused, onTimeUpdate, simTimeRef, speedFactor, componentsMode, controlBools, frameAxis, frameOmega, collapsedDirection, trialToken, basisRef, tabVisible }) {
  const lastReportedSec = useRef(-1);
  const wasVisibleRef = useRef(tabVisible);

  useFrame((state, delta) => {
    // Three's clock ticks in real wall-clock time regardless of whether
    // the tab was actually rendering, so the first frame after regaining
    // visibility reports a delta spanning the whole backgrounded gap.
    // Discard just that one frame's delta (rather than fast-forwarding
    // simTimeRef through however long the tab was hidden) and resume
    // normally from the next frame on.
    const justBecameVisible = tabVisible && !wasVisibleRef.current;
    wasVisibleRef.current = tabVisible;

    if (!paused && tabVisible && !justBecameVisible) simTimeRef.current += speedFactor * delta;
    const t = simTimeRef.current;
    const rounded = Math.floor(t * 10) / 10;
    if (rounded !== lastReportedSec.current) {
      lastReportedSec.current = rounded;
      onTimeUpdate(rounded);
    }
  });

  const field = activeField(magneticField);

  // The rotating component's phase-zero transverse axis, carried forward
  // incrementally each time theta0/phi0 change (see advanceTransverseBasis)
  // rather than recomputed from n alone by a fixed formula.
  const n = unitVectorFromAngles(field.theta0, field.phi0);
  useLayoutEffect(() => {
    basisRef.current = advanceTransverseBasis(basisRef.current, n);
  }, [magneticField.theta0, magneticField.phi0]);

  const applyFrame = (getDir) => (t) => {
    const raw = getDir(t);
    if (!controlBools.frameRotating) return raw;
    return rotateAroundAxis(raw, frameAxis, frameOmega * t);
  };

  // Once a measurement has collapsed the state, the spin arrow holds at the
  // outcome pole rather than continuing to reflect evolveSpin -- a real
  // projective measurement snaps to the measured eigenstate regardless of
  // where the precession had it an instant before.
  const getSpinDirection = applyFrame((t) => collapsedDirection ?? evolveSpin(spinState, field, t, basisRef));
  const getFieldDirection = applyFrame((t) => fieldDirectionAt(field, t, basisRef));
  const componentArrows = getFieldComponentArrows(componentsMode, field, spinState, basisRef);

  const componentLength = (c, t) => magnitude(c.getDirection(t)) * FIELD_MAGNITUDE_DISPLAY_FACTOR;
  const showSimpleConnectors = componentsMode !== 'none' && componentsMode !== 'effectiveField' && componentsMode !== 'xyz';

  const resetKey = `${spinState.theta}|${spinState.phi}|${magneticField.mag0}|${magneticField.theta0}|${magneticField.phi0}|${magneticField.mag1}|${magneticField.omega1}|${magneticField.phase1}|${magneticField.rotatingComponent}|${frameOmega}|${controlBools.frameRotating}|${trialToken}`;

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
        getLength={(t) => fieldMagnitudeAt(field, t, basisRef) * FIELD_MAGNITUDE_DISPLAY_FACTOR}
        length={field.mag0}
        color={0x0066cc} headLength={0.12} headWidth={0.08} shaftWidth={5.0}
      />
      <TimeDrivenAxisLine simTimeRef={simTimeRef} getDirection={(t) => normalize(getFieldDirection(t))} extent={SPHERE_AXIS_EXTENT} color={0x0066cc} />
      {componentArrows.map((c, i) => (
        <TimeDrivenArrow
          key={`${componentsMode}-${i}`}
          simTimeRef={simTimeRef}
          getDirection={applyFrame(c.getDirection)}
          getLength={(t) => componentLength(c, t)}
          length={1}
          color={c.color}
          headLength={0.10} headWidth={0.06} shaftWidth={3.5}
        />
      ))}
      {showSimpleConnectors && componentArrows.map((c, i) => (
        <DashedConnector
          key={`${componentsMode}-connector-${i}`}
          simTimeRef={simTimeRef}
          getPointA={tipPoint(applyFrame(c.getDirection))}
          getPointB={tipPoint(getFieldDirection)}
        />
      ))}
      {componentsMode === 'xyz' && componentArrows.length === 3 && (
        <XYZBoxConnectors
          simTimeRef={simTimeRef}
          tipB={tipPoint(getFieldDirection)}
          tipX={tipPoint(applyFrame(componentArrows[0].getDirection))}
          tipY={tipPoint(applyFrame(componentArrows[1].getDirection))}
          tipZ={tipPoint(applyFrame(componentArrows[2].getDirection))}
        />
      )}
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

function BlochSphere({ spinState, magneticField, paused, setPaused, timeSec, setTimeSec, simTimeRef, speedFactor, setSpeedFactor, componentsMode, controlBools, rotatingFrame, dc, basisRef, graticuleLatCount, graticuleLonCount, tabVisible }) {
  const controlsRef = useRef();
  // Can't use controls.reset(), since target0/position0 get captured before
  // drei applies the `target` prop below, so reset() would snap to the wrong
  // point. Set both explicitly instead.
    // Defaults to panning for the *current* mode (dc.mode, closed over
  // fresh each render) so the "Reset View" button and the auto-repan
  // effect below share one implementation.
  const resetView = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    const offset = dc.mode ? DATA_COLLECTION_CAMERA_PAN : [0, 0, 0];
    controls.object.position.set(...SPHERE_INITIAL_CAMERA_POSITION.map((v, i) => v + offset[i]));
    controls.target.set(...SPHERE_INITIAL_CAMERA_TARGET.map((v, i) => v + offset[i]));
    controls.update();
  };

  // Re-pans automatically on entering/leaving data collection mode, rather
  // than only whenever the user happens to hit "Reset View" -- Canvas's
  // own `camera` prop only sets the *initial* position, so without this
  // the camera would just stay wherever it was as the overlay appears.
  useEffect(() => {
    resetView();
  }, [dc.mode]);

  const axisTicks = useMemo(() => axisSurfaceTicks(), []);

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
    ? (magneticField.rotatingComponent ? -magneticField.omega1 : -magneticField.mag0)
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
              <meshStandardMaterial color="gray" transparent opacity={0.25} side={THREE.FrontSide} depthWrite={false} roughness={0.5} metalness={0.80} />
            </mesh>
          )}

          {(controlBools.showSphere && controlBools.showSphereGrid) && (
            <GraticuleLines latCount={graticuleLatCount} lonCount={graticuleLonCount} />
          )}
          {/*
          {controlBools.showSphere && axisTicks.map((armPoints, i) => (
            <Line key={i} points={armPoints} color="black" lineWidth={2} />
          ))}
          */}

          {controlBools.showAxes &&
          <>
            <ThickArrowHelper dir={blochToThree(1, 0, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
            <ThickArrowHelper dir={blochToThree(0, 1, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
            <ThickArrowHelper dir={blochToThree(0, 0, 1)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
            <ThickArrowHelper dir={blochToThree(-1, 0, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
            <ThickArrowHelper dir={blochToThree(0, -1, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
            <ThickArrowHelper dir={blochToThree(0, 0, -1)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.09} headWidth={0.06} shaftWidth={3.0} />
          {/*
          <Line points={[[-1,0,0],[1,0,0]]} color="black" lineWidth={2} />
          <Line points={[[0,-1,0],[0,1,0]]} color="black" lineWidth={2} />
          <Line points={[[0,0,-1],[0,0,1]]} color="black" lineWidth={2} />
          */}

          <KetLabel sign="+" axis="x" position={blochToThree(SPHERE_AXIS_EXTENT + SPHERE_AXIS_LABEL_EXTENT, 0, 0).toArray()} />
          <KetLabel sign="-" axis="x" position={blochToThree(-(SPHERE_AXIS_EXTENT + SPHERE_AXIS_LABEL_EXTENT), 0, 0).toArray()} />
          <KetLabel sign="+" axis="y" position={blochToThree(0, SPHERE_AXIS_EXTENT + SPHERE_AXIS_LABEL_EXTENT, 0).toArray()} />
          <KetLabel sign="-" axis="y" position={blochToThree(0, -(SPHERE_AXIS_EXTENT + SPHERE_AXIS_LABEL_EXTENT), 0).toArray()} />
          <KetLabel sign="+" axis="z" position={blochToThree(0, 0, SPHERE_AXIS_EXTENT + SPHERE_AXIS_LABEL_EXTENT).toArray()} />
          <KetLabel sign="-" axis="z" position={blochToThree(0, 0, -(SPHERE_AXIS_EXTENT + SPHERE_AXIS_LABEL_EXTENT)).toArray()} />
          </>
          }
        </RotatingFrameBackdrop>

        <SimulationScene
          spinState={spinState} magneticField={magneticField}
          paused={paused} onTimeUpdate={setTimeSec}
          simTimeRef={simTimeRef} speedFactor={speedFactor}
          componentsMode={componentsMode} controlBools={controlBools}
          frameAxis={frameAxisPhysics} frameOmega={frameOmega}
          collapsedDirection={dc.collapsedDirection} trialToken={dc.trialToken}
          basisRef={basisRef} tabVisible={tabVisible}
        />

        <OrbitControls ref={controlsRef} target={SPHERE_INITIAL_CAMERA_TARGET} />
      </Canvas>

      <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', flexDirection: 'column', gap: '10px', width: '250px' }}>
        <div className="overlay-controls">
          {!dc.mode ? (
            <>
              <h3 style={{ marginTop: 0, marginBottom: '6px', textAlign: 'center' }}>Time Controls</h3>
              <label>Time: {timeSec.toFixed(1)} sec</label>
              <div style={{ display: 'flex', flexDirection: 'row', gap: '6px' }}>
                <button className="control-button" onClick={() => setPaused((p) => !p)} style={{ display: 'inline-flex', flex: 1, alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '6px 14px', margin: 0, fontSize: '1.0rem' }}>
                  {paused ? <PlayIcon /> : <PauseIcon />}
                  {paused ? 'Start' : 'Pause'}
                </button>
                <button className="control-button" onClick={() => { simTimeRef.current = 0; }} style={{ flex: 1, padding: '6px 14px', margin: 0, fontSize: '1.0rem' }}>
                  Reset
                </button>
              </div>
              <div className="control-group" style={{ margin: '8px 0px' }}>
                <label>Animation Speed: {speedFactor.toFixed(1)}×</label>
                <input
                  type="range" min={0.1} max={2.0} step={0.1}
                  value={speedFactor}
                  onChange={(e) => setSpeedFactor(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 0, marginBottom: '6px', textAlign: 'center' }}>Experiment Controls</h3>
              <MeasurementAxisStepper axis={dc.axis} setAxis={dc.setAxis} disabled={dc.phase === 'running'} label={"Measurement Axis:"} />

              <div className="control-group" style={{ margin: '0px 0px 16px 0px' }}>
                <label>Delay before measurement: {dc.duration.toFixed(1)} sec</label>
                <input
                  type="range" min={0.1} max={20.0} step={0.1}
                  value={dc.duration}
                  onChange={(e) => dc.setDuration(parseFloat(e.target.value))}
                  disabled={dc.phase === 'running'}
                  style={{ width: '100%' }}
                />
              </div>

              <label>
                Time: {timeSec.toFixed(1)} / {dc.duration.toFixed(1)} sec
              </label>

              <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
                {dc.phase === 'collapsed' ? (
                  <button className="control-button" onClick={dc.onRePrepare} style={{ margin: '4px 0px' }}>
                    Re-prepare
                  </button>
                ) : (
                  <button
                    className="control-button"
                    onClick={dc.onRunTrial}
                    disabled={dc.phase === 'running'}
                    style={{ margin: '4px 0px' }}
                  >
                    {dc.phase === 'running' ? 'Running…' : 'Run One Trial'}
                  </button>
                )}
                <button
                  className="control-button"
                  onClick={dc.onRunBatch}
                  disabled={dc.phase === 'running'}
                  style={{ flex: 1, margin: '4px 0px' }}
                >
                  Run {dc.batchSize} Trials
                </button>
              </div>
            </>
          )}
        </div>

        {dc.mode && (
          <Histogram
            axisLabel={dc.axis.toUpperCase()}
            counts={dc.histogram}
            showTheory={dc.showTheory}
            setShowTheory={dc.setShowTheory}
            theoryProbPlus={dc.theoryProbPlus}
            onClear={dc.onClearHistogram}
          />
        )}
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

// Preset scenarios for the sidebar's "Presets" dropdown. Each fully
// specifies the physical setup (initial spin state, field, rotating-frame
// display) rather than patching individual fields, so picking one always
// lands on a clean, known-good configuration regardless of whatever was
// set before -- no leftover field/frame values from a previous preset or
// manual tweak.
//
// Deliberately not included: adiabatic/rapid passage (slowly sweeping the
// static field's own direction to show the spin either tracking it or
// not). The field's static axis (theta0/phi0) is fixed for the whole
// trial here -- the only built-in time-dependence is the transverse
// component's fixed-axis rotation -- so there's no way to sweep the field
// direction itself over time without extending the physics model.
const PRESETS = [
  {
    key: 'larmor',
    label: 'Larmor precession',
    apply(setters) {
      setters.setInitialSpinState({ theta: Math.PI / 2, phi: 0 });
      setters.setMagneticField({ mag0: 1, theta0: 0, phi0: 0, mag1: 0, omega1: 0, phase1: 0, rotatingComponent: false });
      setters.setControlBools((prev) => ({ ...prev, frameRotating: false, frameLocked: false }));
      setters.setComponentsMode('none');
    },
  },
  // {
  //   key: 'frozenRotatingFrame',
  //   label: 'Larmor precession, in rotating frame',
  //   apply(setters) {
  //     // Same physical setup as Larmor precession above -- the point here
  //     // is purely the rotating-frame view. With no transverse component,
  //     // locking the frame spins it at exactly mag0 (see BlochSphere's
  //     // frameOmega), matching the spin's own precession rate exactly, so
  //     // the spin arrow holds still relative to the (also-rotating) sphere
  //     // and axis labels.
  //     setters.setInitialSpinState({ theta: Math.PI / 2, phi: 0 });
  //     setters.setMagneticField({ mag0: 1, theta0: 0, phi0: 0, mag1: 0, omega1: 0, phase1: 0, rotatingComponent: false });
  //     setters.setControlBools((prev) => ({ ...prev, frameRotating: true, frameLocked: true }));
  //     setters.setComponentsMode('none');
  //   },
  // },
  {
    key: 'onResonanceRabi',
    label: 'On-resonance Rabi flopping',
    apply(setters) {
      // omega1 === -mag0 cancels the (mag0 + omega1) detuning term in the
      // effective field (see effectiveField/evolveSpin), leaving a purely
      // transverse effective field -- starting at the north pole, the spin
      // nutates all the way down to the south pole and back.
      setters.setInitialSpinState({ theta: 0, phi: 0 });
      setters.setMagneticField({ mag0: 1, theta0: 0, phi0: 0, mag1: 1, omega1: -1, phase1: 0, rotatingComponent: true });
      setters.setControlBools((prev) => ({ ...prev, frameRotating: false, frameLocked: false }));
      setters.setComponentsMode('none');
    },
  },
  // {
  //   key: 'onResonanceRabiRotatingFrame',
  //   label: 'On-resonance Rabi (rotating-frame view)',
  //   apply(setters) {
  //     // Same physical setup as the on-resonance preset above, but locking
  //     // the frame to the drive turns the fast lab-frame spiral into the
  //     // textbook picture: the spin simply nutates around a fixed effective
  //     // field, which the "effective field" component display then draws
  //     // directly as a static arrow.
  //     setters.setInitialSpinState({ theta: 0, phi: 0 });
  //     setters.setMagneticField({ mag0: 1, theta0: 0, phi0: 0, mag1: 1, omega1: 1, phase1: 0, rotatingComponent: true });
  //     setters.setControlBools((prev) => ({ ...prev, frameRotating: true, frameLocked: true }));
  //     setters.setComponentsMode('effectiveField');
  //   },
  // },
  {
    key: 'offResonanceRabi',
    label: 'Off-resonance Rabi flopping',
    apply(setters) {
      // Detuning (mag0 + omega1 = 0.5, same size as the drive itself)
      // tilts the effective field away from purely transverse, so the
      // nutation cone -- starting from the north pole, already close to
      // that tilted axis -- never reaches the south pole: incomplete
      // flopping, in contrast to the on-resonance case above.
      setters.setInitialSpinState({ theta: 0, phi: 0 });
      setters.setMagneticField({ mag0: 1, theta0: 0, phi0: 0, mag1: 0.5, omega1: -0.5, phase1: 0, rotatingComponent: true });
      setters.setControlBools((prev) => ({ ...prev, frameRotating: false, frameLocked: false }));
      setters.setComponentsMode('none');
    },
  },
];

export default function App() {
  const [controlBools, setControlBools] = useState({
    frameRotating: false,
    frameLocked: false,
    showSphere: true,
    showSpinTrace: true,
    showAxes: true,
    showSphereGrid: true
  });
  // Spin state at t = 0, set by two angles
  const [initialSpinState, setInitialSpinState] = useState({ theta: 0, phi: 0 });
  // Every element of this array should have a theta, phi, magnitude, omega, and phase (at t=0) specifying it
  const [magneticField, setMagneticField] = useState({ mag0: 1, theta0: 0, phi0: 0, mag1: 0, omega1: 0, phase1: 0, rotatingComponent: false });
  // Rotating frame properties
  const [rotatingFrame, setRotatingFrame] = useState(0); // The value is the rad/s omega of the rotating frame
  // For viewing components of the field
  const [componentsMode, setComponentsMode] = useState('none');
  // Graticule density: how many latitude/longitude lines to draw
  const [graticuleLatCount, setGraticuleLatCount] = useState(7);
  const [graticuleLonCount, setGraticuleLonCount] = useState(6);
  // Pausing the animation
  const [paused, setPaused] = useState(true);
  // Time variable
  const [timeSec, setTimeSec] = useState(0);
  const simTime = useRef(0);
  // Animation speed factor
  const [speedFactor, setSpeedFactor] = useState(1);
  // The sidebar's "Presets" dropdown -- always reset back to '' right
  // after applying one (see applyPreset below), since it's a one-shot
  // action rather than a mode the state keeps matching.
  const [selectedPreset, setSelectedPreset] = useState('');

  // For getting tab visibility and pausing animation as appropriate --
  // without this, simTimeRef keeps advancing (or the next useFrame delta
  // spans the whole backgrounded gap) while the tab is hidden, so
  // switching back shows the spin having fast-forwarded through however
  // long the tab was away instead of picking up where it left off.
  const [tabVisible, setTabVisible] = useState(!document.hidden);
  useEffect(() => {
    const onVisibilityChange = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const basisRef = useRef(null);
  if (basisRef.current === null) {
    const n0 = unitVectorFromAngles(magneticField.theta0, magneticField.phi0);
    const e1 = arbitraryPerpendicular(n0);
    basisRef.current = { n: n0, e1, e2: cross(n0, e1) };
  }

  /********** Data collection mode **********/
  const [dcModeOn, setDcModeOn] = useState(false);
  const [measurementAxis, setMeasurementAxis] = useState('z');
  const [trialDuration, setTrialDuration] = useState(2.0);
  const [batchSize, setBatchSize] = useState(100);
  // 'ready' -- vector sits at the initial state, waiting for Run Trial.
  // 'running' -- animating toward trialDuration.
  // 'collapsed' -- a measurement was made; the vector holds at the outcome
  // pole until Re-prepare snaps it back to the initial state.
  const [trialPhase, setTrialPhase] = useState('ready');
  const [collapsedDirection, setCollapsedDirection] = useState(null);
  // Bumped on every Run Trial / Re-prepare so SimulationScene's resetKey
  // picks it up and clears the sphere trace between trials, even when
  // neither the prepared state nor the field itself changed.
  const [trialToken, setTrialToken] = useState(0);
  const [histogram, setHistogram] = useState({ plus: 0, minus: 0 });
  const [showTheory, setShowTheory] = useState(false);

  // The exact Born-rule P(+axis) for the current preparation, field, axis,
  // and evolution time -- recomputed every render (cheap) rather than
  // memoized, so it always reflects basisRef.current's latest value rather
  // than being stuck with whatever it was on the last render that changed
  // one of the memo's own dependencies.
  const theoryFinalVector = evolveSpin(initialSpinState, activeField(magneticField), trialDuration, basisRef);
  const theoryProbPlus = (1 + dot(theoryFinalVector, axisUnitVector(measurementAxis))) / 2;

  // Any change to what's actually being measured -- the prepared state, the
  // field driving its evolution, which axis is measured, or how long it
  // evolves before measurement -- makes previously collected counts refer
  // to a different experiment, so each of the setters that can change one
  // of those (below) also clears the trial bookkeeping right where the
  // change happens, rather than mixing old and new counts together.
  function resetTrialData() {
    setHistogram({ plus: 0, minus: 0 });
    setTrialPhase('ready');
    setCollapsedDirection(null);
  }

  // Watches the (throttled, ~10Hz) time readout for a running trial to
  // reach its target duration. The actual Born-rule probability used to
  // draw the outcome comes from theoryProbPlus, evaluated at the exact
  // nominal trialDuration -- not from whatever simTime happens to have
  // reached when this effect fires -- so a little animation-frame jitter
  // in when the trial is detected as "done" can't skew the physics.
  useEffect(() => {
    if (!dcModeOn || trialPhase !== 'running') return;
    if (timeSec < trialDuration) return;

    const axisVec = axisUnitVector(measurementAxis);
    const outcome = Math.random() < theoryProbPlus ? 'plus' : 'minus';
    const outcomeVec = outcome === 'plus' ? axisVec : { x: -axisVec.x, y: -axisVec.y, z: -axisVec.z };

    simTime.current = trialDuration;
    setPaused(true);
    setCollapsedDirection(outcomeVec);
    setHistogram((prev) => ({ ...prev, [outcome]: prev[outcome] + 1 }));
    setTrialPhase('collapsed');
  }, [timeSec, dcModeOn, trialPhase, trialDuration, measurementAxis, theoryProbPlus]);

  function handleRunTrial() {
    if (trialPhase !== 'ready') return;
    simTime.current = 0;
    setCollapsedDirection(null);
    setTrialToken((t) => t + 1);
    setTrialPhase('running');
    setPaused(false);
  }

  function handleRePrepare() {
    simTime.current = 0;
    setCollapsedDirection(null);
    setTrialToken((t) => t + 1);
    setPaused(true);
    setTrialPhase('ready');
  }

  function handleRunBatch() {
    const n = Math.max(1, Math.round(batchSize));
    let plusCount = 0;
    for (let i = 0; i < n; i++) {
      if (Math.random() < theoryProbPlus) plusCount++;
    }
    setHistogram((prev) => ({ plus: prev.plus + plusCount, minus: prev.minus + (n - plusCount) }));
  }

  function handleClearHistogram() {
    setHistogram({ plus: 0, minus: 0 });
  }

  function handleSetMeasurementAxis(axis) {
    setMeasurementAxis(axis);
    resetTrialData();
  }

  function handleSetTrialDuration(duration) {
    setTrialDuration(duration);
    resetTrialData();
  }

  // Toggling the mode itself also snaps back to a clean, paused,
  // initial-state view -- otherwise leaving the mode right after a
  // collapse would strand the vector frozen at trialDuration instead of
  // back at t = 0.
  function handleSetDataCollectionMode(on) {
    setDcModeOn(on);
    resetTrialData();
    setPaused(true);
    simTime.current = 0;
  }

  const dc = {
    mode: dcModeOn, setMode: handleSetDataCollectionMode,
    axis: measurementAxis, setAxis: handleSetMeasurementAxis,
    duration: trialDuration, setDuration: handleSetTrialDuration,
    batchSize, setBatchSize,
    phase: trialPhase,
    collapsedDirection, trialToken,
    histogram, showTheory, setShowTheory, theoryProbPlus,
    onRunTrial: handleRunTrial, onRePrepare: handleRePrepare,
    onRunBatch: handleRunBatch, onClearHistogram: handleClearHistogram,
  };

  // For setting just one property of a magnetic field
  // Usage example: updateField({ theta: parseFloat(e.target.value) })
  function updateField(patch) {
    setMagneticField(prev => ({ ...prev, ...patch }));
    resetTrialData();
  }
  function updateSpinState(patch) {
    setInitialSpinState(prev => ({ ...prev, ...patch }));
    resetTrialData();
  }

  // A preset is a one-shot action (load this configuration), not a
  // persistent mode the dropdown keeps tracking -- so it resets back to
  // its placeholder immediately rather than continuing to claim "you're
  // viewing <preset>" after the user has since dragged a slider away from
  // it. Also always drops out of data collection mode: presets are for
  // watching a scenario play out, and handleSetDataCollectionMode's own
  // pause/reset-to-t=0 gives every preset the same clean starting point.
  function applyPreset(key) {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    handleSetDataCollectionMode(false);
    preset.apply({ setInitialSpinState, setMagneticField, setControlBools, setComponentsMode });
    setSelectedPreset('');
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
          componentsMode={componentsMode}
          controlBools={controlBools} rotatingFrame={rotatingFrame}
          dc={dc} basisRef={basisRef}
          graticuleLatCount={graticuleLatCount} graticuleLonCount={graticuleLonCount}
          tabVisible={tabVisible}
        />
      </div>

      {/* Right Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-content">
          <div className="panel-controls">
            <div>
              <div className="control-group" style={{ gap: '0px' }}>
                <label>Simulation Mode:</label>
                <select value={dcModeOn ? 'true' : 'false'} onChange={(e) => handleSetDataCollectionMode(e.target.value === 'true')}>
                  <option value="false">Time evolution</option>
                  <option value="true">Data collection</option>
                </select>
              </div>
              <div className="control-group" style={{ gap: '0px' }}>
                <label>Presets:</label>
                <select value={selectedPreset} onChange={(e) => applyPreset(e.target.value)}>
                  <option value="" disabled>Choose a preset…</option>
                  {PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>{preset.label}</option>
                  ))}
                </select>
              </div>

              <hr className="sidebar-divider" />

              <h3>Spin State at t = 0</h3>
              <div style={{ display: 'flex', flexDirection: 'row', gap: '4px', marginBottom: '12px' }}>
                {AXIS_EIGENSTATES.map(({ sign, axis, theta, phi }) => (
                  <button
                    key={`${sign}${axis}`}
                    className="control-button"
                    onClick={() => updateSpinState({ theta, phi })}
                    aria-label={`Set initial state to |${sign}${axis}⟩`}
                    style={{ flex: 1, aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, margin: 0 }}
                  >
                    <KetIcon sign={sign} axis={axis} />
                  </button>
                ))}
              </div>
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
                <SliderPlusTextboxControl label="Mag." valueNum={magneticField.mag0.toFixed(1)} onChangeNum={(val) => updateField({ mag0: val })} min={0.0} max={2.5} step={0.1} />
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
                      min={0.0} max={2.5} step={0.1}
                    />
                    {/* The sign flip is intention here */}
                    <SliderPlusTextboxControl
                      label="ω (rad/s)"
                      valueNum={(-magneticField.omega1 || 0).toFixed(1)}
                      onChangeNum={(val) => updateField({ omega1: -val })}
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
              <div className="control-group" style={{ gap: '0px', marginBottom: '10px' }}>
                <label>Display B-field components:</label>
                <select value={componentsMode} onChange={(e) => setComponentsMode(e.target.value)}>
                  <option value="none">None</option>
                  <option value="xyz">X / Y / Z</option>
                  <option value="staticAxis">Static/rotating parts</option>
                  <option value="spin">Relative to spin</option>
                  <option value="effectiveField">Effective field (rotating frame)</option>
                </select>
              </div>
              <div className="control-group" style={{ gap: '0px' }}>
                <label>
                  <input type="checkbox" checked={controlBools.showSphere} onChange={(e) => setControlBools({ ...controlBools, showSphere: e.target.checked })} />
                  Show sphere
                </label>
                <label>
                  <input type="checkbox" checked={controlBools.showSphereGrid} onChange={(e) => setControlBools({ ...controlBools, showSphereGrid: e.target.checked })} />
                  Show sphere grid
                </label>
                <label>
                  <input type="checkbox" checked={controlBools.showAxes} onChange={(e) => setControlBools({ ...controlBools, showAxes: e.target.checked })} />
                  Show axes
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