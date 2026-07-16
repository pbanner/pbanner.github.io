import React, { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import ThickArrowHelper from './ThickArrowHelper.jsx';
import * as THREE from 'three';

// ---- Physical parameters ----
// k and omega are the spatial and angular frequencies;
// these are visual parameters only, controlling the apparent
// spatial wavelength and the apparent speed of the wave
const K = 2.7;
const OMEGA = 2;

const X_MIN = -5;   // source end
const X_MAX = 0;    // observation plane
const N_SAMPLES = 251;

// Horizontal (red) component -> drawn along Three.js Z
// theta splits the amplitude between the two components,
// phi is the relative phase between them (V minus H)
function Ehoriz(x, t, theta) {
  return Math.cos(theta) * Math.cos(K * x - OMEGA * t);
}
// Vertical (blue) component -> drawn along Three.js Y
// The minus sign accounts for the way JS defines "positive" and how
//    we view everything.
function Evert(x, t, theta, phi) {
  return -Math.sin(theta) * Math.cos(K * x - OMEGA * t + phi);
}

const xs = Array.from(
  { length: N_SAMPLES },
  (_, i) => X_MIN + (i * (X_MAX - X_MIN)) / (N_SAMPLES - 1)
);

const pieceStyle = {
  border: '2px solid #333',
  borderRadius: '20px',
  padding: '12px',
  boxSizing: 'border-box',
  //background: '#eef6ff'
};

const animControlsWrapperStyle = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '6px',
  //border: '1px dashed #999',
  //borderRadius: '4px',
  color: '#666',
  fontSize: '0.9rem',
  textAlign: 'center',
  boxSizing: 'border-box',
  padding: '6px 6px 20px 6px',
};

// One of the two "lower" boxes inside AnimControls — a labeled group with a
// light border, distinct from the outer dashed AnimControls box.
const controlBoxStyle = {
  flex: 1,
  border: '1px solid #ccc',
  borderRadius: '6px',
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: '0.72rem',
  lineHeight: 1.2,
  boxSizing: 'border-box',
};

const checkboxColumnStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  whiteSpace: 'nowrap',
};

// One row of a slider + a synced number box, matching AngleControl in
// App.jsx in spirit — inert for now, not wired to any state yet.
function DummyAngleRow({ label, defaultValue, min, max }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
      <span style={{ minWidth: '14px' }}>{label}</span>
      <input type="range" defaultValue={defaultValue} min={min} max={max} style={{ flex: 1 }} />
      <input type="number" defaultValue={defaultValue} min={min} max={max} style={{ width: '48px' }} />
    </div>
  );
}

// 2D drawing helpers
// Physics (h, v) -> pixel coordinates. Note the v-flip: canvas y increases
// downward, but we want +v to read as "up" on screen.
function toPixel(h, v, cx, cy, scale) {
  return { x: cx + h * scale, y: cy - v * scale };
}

function drawPolyline(ctx, points, cx, cy, scale, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach(({ h, v }, i) => {
    const { x, y } = toPixel(h, v, cx, cy, scale);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// tip/angle/size are all in plain pixel space — a fixed-size arrowhead,
// no length-scaling gotcha like we had with ArrowHelper.
function drawArrowhead(ctx, tip, angle, size) {
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(angle - spread), tip.y - size * Math.sin(angle - spread));
  ctx.lineTo(tip.x - size * Math.cos(angle + spread), tip.y - size * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}

function drawAxisArrows(ctx, cx, cy, scale) {
  const extent = 1.5;
  ctx.strokeStyle = 'black';
  ctx.fillStyle = 'black';
  ctx.lineWidth = 1;

  const hEnd = toPixel(extent, 0, cx, cy, scale);
  ctx.beginPath();
  ctx.moveTo(toPixel(-extent, 0, cx, cy, scale).x, cy);
  ctx.lineTo(hEnd.x, hEnd.y);
  ctx.stroke();
  drawArrowhead(ctx, hEnd, 0, 10);

  const vEnd = toPixel(0, extent, cx, cy, scale);
  ctx.beginPath();
  ctx.moveTo(cx, toPixel(0, -extent, cx, cy, scale).y);
  ctx.lineTo(vEnd.x, vEnd.y);
  ctx.stroke();
  drawArrowhead(ctx, vEnd, -Math.PI / 2, 10);
}

// Fixed reference frame: propagation axis + local transverse-axis indicators at the source
function Axes() {
  return (
    <>
      <ThickArrowHelper dir={new THREE.Vector3(1, 0, 0)} origin={new THREE.Vector3(X_MIN, 0, 0)} length={X_MAX - X_MIN} color={0x000000} headLength={0.2} headWidth={0.1} shaftWidth={2} />
      <ThickArrowHelper dir={new THREE.Vector3(0, 1, 0)} origin={new THREE.Vector3(X_MIN, -1, 0)} length={2} color={0x000000} headLength={0.2} headWidth={0.1} shaftWidth={2} />
      <ThickArrowHelper dir={new THREE.Vector3(0, 0, 1)} origin={new THREE.Vector3(X_MIN, 0, -1)} length={2} color={0x000000} headLength={0.2} headWidth={0.1} shaftWidth={2} />
    </>
  );
}

// Gray square marking the observation plane at x = 0
function ObservationPlane() {
  const points = [
    new THREE.Vector3(0, -1, -1),
    new THREE.Vector3(0, 1, -1),
    new THREE.Vector3(0, 1, 1),
    new THREE.Vector3(0, -1, 1),
    new THREE.Vector3(0, -1, -1),
  ];
  return <Line points={points} color="gray" lineWidth={1} />;
}

// One field component's traveling sinusoid: an outline curve plus a translucent "curtain"
// down to the propagation axis. axis is 'Y' or 'Z' depending on which component this is.
function FieldCurtain({ vectorFn, color, opacity, paused, visible }) {
  const lineGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_SAMPLES * 3), 3));
    return geo;
  }, []);

  const ribbonGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_SAMPLES * 2 * 3), 3));
    const indices = [];
    for (let i = 0; i < N_SAMPLES - 1; i++) {
      const a = 2 * i, b = 2 * i + 1, c = 2 * (i + 1), d = 2 * (i + 1) + 1;
      indices.push(a, b, c, b, d, c);
    }
    geo.setIndex(indices);
    return geo;
  }, []);

  const simTime = useRef(0);

  useFrame((state, delta) => {
    if (!paused) simTime.current += delta;
    const t = simTime.current;
    const linePos = lineGeometry.attributes.position.array;
    const ribbonPos = ribbonGeometry.attributes.position.array;

    for (let i = 0; i < N_SAMPLES; i++) {
      const x = xs[i];
      const { y, z } = vectorFn(x, t);

      linePos[3 * i] = x;
      linePos[3 * i + 1] = y;
      linePos[3 * i + 2] = z;

      const top = 2 * i, base = 2 * i + 1;
      ribbonPos[3 * top] = x;      ribbonPos[3 * top + 1] = y;   ribbonPos[3 * top + 2] = z;
      ribbonPos[3 * base] = x;     ribbonPos[3 * base + 1] = 0;  ribbonPos[3 * base + 2] = 0;
    }

    lineGeometry.attributes.position.needsUpdate = true;
    ribbonGeometry.attributes.position.needsUpdate = true;
  });

  return (
    <>
      <line geometry={lineGeometry} visible={visible}>
        <lineBasicMaterial color="#666666" lineWidth={1} />
      </line>
      <mesh geometry={ribbonGeometry} visible={visible}>
        <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </>
  );
}

function updateArrow(arrow, vec) {
  if (!arrow) return;
  const length = vec.length();
  if (length < 1e-4) {
    arrow.visible = false;
    return;
  }
  arrow.visible = true;
  arrow.setDirection(vec.clone().normalize());
  const headLength = Math.min(0.15, length * 0.4);
  arrow.setLength(length, headLength, headLength * 0.5);
}

// Red/blue component arrows and the green total-field arrow, all evaluated at x = 0
function FieldVectors({ theta, phi, paused, displayBools }) {
  const redArrow = useRef();
  const blueArrow = useRef();
  const greenArrow = useRef();
  const simTime = useRef(0);

  const showCompArrows = (displayBools.obsPlane && displayBools.compArrows);
  const showTotalArrow = (displayBools.obsPlane && displayBools.totalArrow);

  useFrame((state, delta) => {
    if (!paused) simTime.current += delta;
    const t = simTime.current;
    const eh = Ehoriz(0, t, theta);
    const ev = Evert(0, t, theta, phi);

    updateArrow(redArrow.current, new THREE.Vector3(0, 0, eh));
    updateArrow(blueArrow.current, new THREE.Vector3(0, ev, 0));
    updateArrow(greenArrow.current, new THREE.Vector3(0, ev, eh));
  });

  return (
    <>
      <ThickArrowHelper ref={redArrow} dir={new THREE.Vector3(0, 0, 1)} origin={new THREE.Vector3(0, 0, 0)} length={0.01} color={0xff0000} shaftWidth={1.5} visible={showCompArrows} />
      <ThickArrowHelper ref={blueArrow} dir={new THREE.Vector3(0, 1, 0)} origin={new THREE.Vector3(0, 0, 0)} length={0.01} color={0x00ccff} shaftWidth={1.5} visible={showCompArrows} />
      <ThickArrowHelper ref={greenArrow} dir={new THREE.Vector3(0, 1, 0)} origin={new THREE.Vector3(0, 0, 0)} length={0.01} color={0x008000} shaftWidth={1.5} visible={showTotalArrow} />
    </>
  );
}

// Dimension-agnostic: just the (horizontal, vertical) field-vector-tip
// trace over one period. Both renderers consume this directly.
function computeEllipsePoints(theta, phi, samples = 200) {
  const period = (2 * Math.PI) / OMEGA;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * period;
    pts.push({ h: Ehoriz(0, t, theta), v: Evert(0, t, theta, phi) });
  }
  return pts;
}

// 3D version — used inside the wave-animation Canvas
function PolarizationEllipse({ theta, phi, visible }) {
  const points = useMemo(
    () => computeEllipsePoints(theta, phi).map(({ h, v }) => new THREE.Vector3(0, v, h)),
    [theta, phi]
  );
  return <Line points={points} color="green" lineWidth={2} visible={visible} />;
}

function AnimControls({ paused, setPaused, animDisplayBools, setAnimDisplayBools }) {
  return (
    <div style={animControlsWrapperStyle}>
      {/* Row 1: play/pause, centered on its own */}
      <button className="control-button" onClick={() => setPaused((p) => !p)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', margin: 0 }}>
        <span aria-hidden="true">{paused ? '▶' : '⏸'}</span>
        {paused ? 'Start' : 'Pause'}
      </button>

      {/* Row 2: visibility checkboxes (left) + component basis (right) */}
      <div style={{ display: 'flex', width: '100%', gap: '10px', alignItems: 'stretch' }}>
        <div style={controlBoxStyle}>
          <p style={{ margin: '0 0 10px 0', fontWeight: 'bold' }}>Change what is visible</p>
          <div style={{ display: 'flex', gap: '14px' }}>
            <div style={checkboxColumnStyle}>
              <label><input type="checkbox" checked={animDisplayBools.compFields} onChange={(e) => setAnimDisplayBools({ ...animDisplayBools, compFields: e.target.checked })} /> Wave components</label>
              <label><input type="checkbox" checked={animDisplayBools.totalField} onChange={(e) => setAnimDisplayBools({ ...animDisplayBools, totalField: e.target.checked })} /> Total wave</label>
            </div>
            <div style={checkboxColumnStyle}>
              <label><input type="checkbox" checked={animDisplayBools.obsPlane} onChange={(e) => setAnimDisplayBools({ ...animDisplayBools, obsPlane: e.target.checked })} /> Observation plane</label>
              <label><input type="checkbox" disabled={!animDisplayBools.obsPlane} checked={animDisplayBools.obsPlaneEllipse} onChange={(e) => setAnimDisplayBools({ ...animDisplayBools, obsPlaneEllipse: e.target.checked })} /> Polarization ellipse</label>
              <label><input type="checkbox" disabled={!animDisplayBools.obsPlane} checked={animDisplayBools.compArrows} onChange={(e) => setAnimDisplayBools({ ...animDisplayBools, compArrows: e.target.checked })} /> Component field vectors</label>
              <label><input type="checkbox" disabled={!animDisplayBools.obsPlane} checked={animDisplayBools.totalArrow} onChange={(e) => setAnimDisplayBools({ ...animDisplayBools, totalArrow: e.target.checked })} /> Total field vector</label>
            </div>
          </div>
        </div>

        <div style={controlBoxStyle}>
          <p style={{ margin: '0 0 10px 0', fontWeight: 'bold' }}>Component basis</p>
          <DummyAngleRow label="θ" defaultValue={45} min={0} max={90} />
          <DummyAngleRow label="φ" defaultValue={0} min={-180} max={180} />
        </div>
      </div>
    </div>
  );
}

function EllipseVisualizer({ theta, phi }) {
  const containerRef = useRef();
  const canvasRef = useRef();

  // Negate h: the 3D wave-animation Canvas views the observation plane from
  // a camera on the +x side looking back toward the source, which mirrors
  // the horizontal axis relative to this panel's plain (h, v) -> (right, up)
  // pixel mapping. Flipping h here keeps this head-on view in agreement
  // with that Canvas's ellipse shape and rotation direction.
  const points = useMemo(
    () => computeEllipsePoints(theta, phi).map(({ h, v }) => ({ h: -h, v })),
    [theta, phi]
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    function draw() {
      const { width, height } = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cx = width / 2;
      const cy = height / 2;
      const margin = 24;
      const scale = (Math.min(width, height) - 2 * margin) / (2 * 1.5);

      ctx.clearRect(0, 0, width, height);
      drawAxisArrows(ctx, cx, cy, scale);
      drawPolyline(ctx, points, cx, cy, scale*1.4, 'green', 2);

      // Only drawing if ellipticity >~ 6°
      if (((Math.abs(theta) > 0.001) && (Math.abs(theta - 0.5*Math.PI) > 0.001)) && ((Math.abs(phi) > 0.001) && (Math.abs(phi - Math.PI) > 0.001) && (Math.abs(phi + Math.PI) > 0.001))) {
        // Handedness marker: an arrowhead riding directly on the ellipse,
        // tangent to its own path — the point order already encodes the
        // true direction of travel, so no separate rotation-sign math needed.
        const idx = Math.floor(points.length * 0.25);
        const p0 = points[idx];
        const p1 = points[idx + 1];
        const angle = Math.atan2(-(p1.v - p0.v), p1.h - p0.h);
        ctx.fillStyle = 'green';
        drawArrowhead(ctx, toPixel(p0.h, p0.v, cx, cy, scale*1.4), angle, 10);
      }
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [points, phi]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function PoincareSpherePlaceholder() {
  return (
    <Canvas camera={{ position: [2, 2, 2], fov: 40 }} style={{ width: '100%', height: '100%' }}>
      <mesh>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="steelblue" wireframe />
      </mesh>
      <OrbitControls />
    </Canvas>
  );
}

export default function Panel2({ polState, setPolState, panel2displayBools }) {
  const { theta, phi } = polState;
  const { animation: showAnimation, ellipse: showEllipse, sphere: showSphere } = panel2displayBools;
  const [paused, setPaused] = useState(false);
  const [animDisplayBools, setAnimDisplayBools] = useState({ compFields: false, totalField: true, obsPlane: true, obsPlaneEllipse: false, compArrows: false, totalArrow: true });

  // Switching tabs such that this sim is no longer visible should pause the animation.
  // Create a ref so that the paused state survives re-render (paused must remain state
  // so a re-render is triggered when it changes).
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Keep this to track whether the user had manually paused the animation before switch.
  const pausedBeforeHideRef = useRef(false);
  // Effect is created once but relies on ref variables
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) {
        pausedBeforeHideRef.current = pausedRef.current;
        setPaused(true);
      } else if (!pausedBeforeHideRef.current) {
        setPaused(false);
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '0.75rem', width: '100%', height: '100%', padding: '20px', boxSizing: 'border-box' }}>
      {/* Left column: wave animation + controls, as one bordered piece */}
      <div style={{ minWidth: 0, minHeight: 0 }}>
        <div style={{
          ...pieceStyle,
          display: showAnimation ? 'grid' : 'none',
          gridTemplateRows: '75% 25%',
          gap: '0.75rem',
          width: '100%',
          height: '100%',
        }}>
          <div style={{ minWidth: 0, minHeight: 0 }}>
            <h3 style={{ textAlign: 'center', marginTop: '0.75em', marginBottom: '-0.75em' }}>Electric Field Components</h3>
            <Canvas camera={{ position: [4, 2, 4], fov: 32 }} style={{ width: '100%', height: '100%' }}>
              <Axes />
              {animDisplayBools.obsPlane && <ObservationPlane />}
              <PolarizationEllipse theta={theta} phi={phi} visible={animDisplayBools.obsPlane && animDisplayBools.obsPlaneEllipse} />
              <FieldCurtain vectorFn={(x, t) => ({ y: 0, z: Ehoriz(x, t, theta) })} color="red" opacity={0.25} paused={paused} visible={animDisplayBools.compFields} />
              <FieldCurtain vectorFn={(x, t) => ({ y: Evert(x, t, theta, phi), z: 0 })} color="#00ccff" opacity={0.2} paused={paused} visible={animDisplayBools.compFields} />
              <FieldCurtain vectorFn={(x, t) => ({ y: Evert(x, t, theta, phi), z: Ehoriz(x, t, theta) })} color="green" opacity={0.15} paused={paused} visible={animDisplayBools.totalField} />
              <FieldVectors theta={theta} phi={phi} paused={paused} displayBools={animDisplayBools} />
              <OrbitControls target={[-1.5, -0.3, 0]} />
            </Canvas>
          </div>
          <div style={{ minWidth: 0, minHeight: 0 }}>
            <AnimControls paused={paused} setPaused={setPaused} animDisplayBools={animDisplayBools} setAnimDisplayBools={setAnimDisplayBools} />
          </div>
        </div>
      </div>

      {/* Right column: ellipse view (top half) + Poincaré sphere (bottom half) */}
      <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: '0.75rem', minWidth: 0, minHeight: 0 }}>
        <div style={{ minWidth: 0, minHeight: 0 }}>
          <div style={{ ...pieceStyle, display: showEllipse ? 'block' : 'none', width: '100%', height: '100%' }}>
            <h3 style={{ textAlign: 'center', marginTop: '0.0em', marginBottom: '-0.5em' }}>Polarization Ellipse</h3>
            <EllipseVisualizer theta={theta} phi={phi} />
          </div>
        </div>
        <div style={{ minWidth: 0, minHeight: 0 }}>
          <div style={{ ...pieceStyle, display: showSphere ? 'block' : 'none', width: '100%', height: '100%' }}>
            <h3 style={{ textAlign: 'center', marginTop: '0.0em', marginBottom: '-0.5em' }}>Poincare Sphere</h3>
            <PoincareSpherePlaceholder />
          </div>
        </div>
      </div>
    </div>
  );
}