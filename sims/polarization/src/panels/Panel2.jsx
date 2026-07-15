import React, { useLayoutEffect, useMemo, useRef } from 'react';
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
// theta splits the amplitude between the two components
const THETA = Math.atan(1);
// phi is the relative phase between the components, V minus H
const PHI = 90 * (Math.PI / 180);

const X_MIN = -5;   // source end
const X_MAX = 0;    // observation plane
const N_SAMPLES = 251;

const cosT = Math.cos(THETA);
const sinT = Math.sin(THETA);

// Horizontal (red) component -> drawn along Three.js Z
function Ehoriz(x, t) {
  return cosT * Math.cos(K * x - OMEGA * t);
}
// Vertical (blue) component -> drawn along Three.js Y
function Evert(x, t) {
  return sinT * Math.cos(K * x - OMEGA * t + PHI);
}

const xs = Array.from(
  { length: N_SAMPLES },
  (_, i) => X_MIN + (i * (X_MAX - X_MIN)) / (N_SAMPLES - 1)
);

const placeholderStyle = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px dashed #999',
  borderRadius: '4px',
  color: '#666',
  fontSize: '0.9rem',
  textAlign: 'center',
  boxSizing: 'border-box',
};

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
function FieldCurtain({ fieldFn, axis, color, opacity }) {
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

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const linePos = lineGeometry.attributes.position.array;
    const ribbonPos = ribbonGeometry.attributes.position.array;

    for (let i = 0; i < N_SAMPLES; i++) {
      const x = xs[i];
      const value = fieldFn(x, t);
      const y = axis === 'Y' ? value : 0;
      const z = axis === 'Z' ? value : 0;

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
      <line geometry={lineGeometry}>
        <lineBasicMaterial color="#666666" lineWidth={1} />
      </line>
      <mesh geometry={ribbonGeometry}>
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
function FieldVectors() {
  const redArrow = useRef();
  const blueArrow = useRef();
  const greenArrow = useRef();

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const eh = Ehoriz(0, t);
    const ev = Evert(0, t);

    updateArrow(redArrow.current, new THREE.Vector3(0, 0, eh));
    updateArrow(blueArrow.current, new THREE.Vector3(0, ev, 0));
    updateArrow(greenArrow.current, new THREE.Vector3(0, ev, eh));
  });

  return (
    <>
      <ThickArrowHelper ref={redArrow} dir={new THREE.Vector3(0, 0, 1)} origin={new THREE.Vector3(0, 0, 0)} length={0.01} color={0xff0000} shaftWidth={1.5} />
      <ThickArrowHelper ref={blueArrow} dir={new THREE.Vector3(0, 1, 0)} origin={new THREE.Vector3(0, 0, 0)} length={0.01} color={0x00ccff} shaftWidth={1.5} />
      <ThickArrowHelper ref={greenArrow} dir={new THREE.Vector3(0, 1, 0)} origin={new THREE.Vector3(0, 0, 0)} length={0.01} color={0x008000} shaftWidth={1.5} />
    </>
  );
}

// Dimension-agnostic: just the (horizontal, vertical) field-vector-tip
// trace over one period. Both renderers consume this directly.
function computeEllipsePoints(samples = 200) {
  const period = (2 * Math.PI) / OMEGA;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * period;
    pts.push({ h: Ehoriz(0, t), v: Evert(0, t) });
  }
  return pts;
}

// 3D version — used inside the wave-animation Canvas, unchanged call site
function PolarizationEllipse() {
  const points = useMemo(
    () => computeEllipsePoints().map(({ h, v }) => new THREE.Vector3(0, v, h)),
    []
  );
  return <Line points={points} color="green" lineWidth={2} />;
}

function ControlsPlaceholder() {
  return (
    <div style={placeholderStyle}>
      <span>Basis controls — coming soon</span>
    </div>
  );
}

function EllipseVisualizer() {
  const containerRef = useRef();
  const canvasRef = useRef();

  const points = useMemo(() => computeEllipsePoints(), []);

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
      drawPolyline(ctx, points, cx, cy, scale*1.5, 'green', 2);

      // Only drawing if ellipticity >~ 6°
      if (math.abs(PHI) > 0.001) {
        // Handedness marker: an arrowhead riding directly on the ellipse,
        // tangent to its own path — the point order already encodes the
        // true direction of travel, so no separate rotation-sign math needed.
        const idx = Math.floor(points.length * 0.25);
        const p0 = points[idx];
        const p1 = points[idx + 1];
        const angle = Math.atan2(-(p1.v - p0.v), p1.h - p0.h);
        ctx.fillStyle = 'green';
        drawArrowhead(ctx, toPixel(p0.h, p0.v, cx, cy, scale*1.5), angle, 10);
      }
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [points]);

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

export default function Panel2() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '60% 40%', gap: '0.75rem', width: '100%', height: '100%', boxSizing: 'border-box' }}>
      {/* Left column: wave animation (75%) + controls (25%) */}
      <div style={{ display: 'grid', gridTemplateRows: '75% 25%', gap: '0.75rem', minWidth: 0, minHeight: 0 }}>
        <div style={{ minWidth: 0, minHeight: 0 }}>
          <Canvas camera={{ position: [6, 3, 6], fov: 35 }} style={{ width: '100%', height: '100%' }}>
            <Axes />
            <ObservationPlane />
            <PolarizationEllipse />
            <FieldCurtain fieldFn={Ehoriz} axis="Z" color="red" opacity={0.25} />
            <FieldCurtain fieldFn={Evert} axis="Y" color="#00ccff" opacity={0.15} />
            <FieldVectors />
            <OrbitControls target={[-2, 0, 0]} />
          </Canvas>
        </div>
        <ControlsPlaceholder />
      </div>

      {/* Right column: ellipse view (top half) + Poincaré sphere (bottom half) */}
      <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: '0.75rem', minWidth: 0, minHeight: 0 }}>
        <div style={{ minWidth: 0, minHeight: 0 }}>
          <EllipseVisualizer />
        </div>
        <div style={{ minWidth: 0, minHeight: 0 }}>
          <PoincareSpherePlaceholder />
        </div>
      </div>
    </div>
  );
}