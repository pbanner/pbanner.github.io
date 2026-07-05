import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
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

// Fixed reference frame: propagation axis + local transverse-axis indicators at the source
function Axes() {
  return (
    <>
      <arrowHelper args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(X_MIN, 0, 0), X_MAX - X_MIN, 0x000000, 0.3, 0.15]} />
      <arrowHelper args={[new THREE.Vector3(0, 1, 0), new THREE.Vector3(X_MIN, -1, 0), 2, 0x000000, 0.2, 0.1]} />
      <arrowHelper args={[new THREE.Vector3(0, 0, 1), new THREE.Vector3(X_MIN, 0, -1), 2, 0x000000, 0.2, 0.1]} />
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
        <lineBasicMaterial color="black" />
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
      <arrowHelper ref={redArrow} args={[new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 0.01, 0xff0000]} />
      <arrowHelper ref={blueArrow} args={[new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 0.01, 0x00ccff]} />
      <arrowHelper ref={greenArrow} args={[new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 0.01, 0x008000]} />
    </>
  );
}

// Static reference curve: the polarization ellipse traced by the field vector's tip
function PolarizationEllipse() {
  const points = useMemo(() => {
    const period = (2 * Math.PI) / OMEGA;
    const M = 200;
    const pts = [];
    for (let i = 0; i <= M; i++) {
      const t = (i / M) * period;
      pts.push(new THREE.Vector3(0, Evert(0, t), Ehoriz(0, t)));
    }
    return pts;
  }, []);
  return <Line points={points} color="green" lineWidth={2} />;
}

export default function Panel2() {
  return (
    <Canvas camera={{ position: [6, 3, 6], fov: 35 }} style={{ width: '100%', height: '100%' }}>
      <Axes />
      <ObservationPlane />
      <PolarizationEllipse />
      <FieldCurtain fieldFn={Ehoriz} axis="Z" color="red" opacity={0.25} />
      <FieldCurtain fieldFn={Evert} axis="Y" color="#00ccff" opacity={0.15} />
      <FieldVectors />
      <OrbitControls target={[-2, 0, 0]} />
    </Canvas>
  );
}