import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import ThickArrowHelper from './ThickArrowHelper.jsx';
import * as THREE from 'three';
import './App.css';

/********** Constants and initial values **********/
const SPHERE_INITIAL_CAMERA_POSITION = [3.3, 2.4, 3.6];
const SPHERE_INITIAL_CAMERA_TARGET = [0, 0.32, 0];

/************************************************
*
* Helpers for sphere drawing
*
************************************************/

// Stokes-parameter coordinates for the current polarization state, using the
// same (theta, phi) convention as the wave animation: theta splits the H/V
// amplitude, phi is the V-relative-to-H phase. This is the standard Poincare
// sphere parametrization -- polar angle 2*theta measured from the S1 axis,
// azimuthal angle phi around it -- so (s1,s2,s3) automatically lands exactly
// on the unit sphere for any (theta, phi).
//
// The sign of s3 is the one physically meaningful choice here (s1's sign
// just picks which pole is "H" vs "V", and s2's sign just picks which
// diagonal is +45 deg -- neither has a required convention). It's chosen so
// that theta=45deg, phi=+90deg sits at the TOP (s3=+1): with this app's
// Evert sign convention, that state traces counterclockwise as seen by an
// observer facing the oncoming wave -- the same viewpoint used by the wave
// Canvas's camera and the flat Polarization Ellipse panel -- which is the
// rotation sense this sphere calls "left-circular".
function stokesFromState(theta, phi) {
  const s1 = Math.cos(2 * theta);
  const s2 = Math.sin(2 * theta) * Math.cos(phi);
  const s3 = Math.sin(2 * theta) * Math.sin(phi);
  return { s1, s2, s3 };
}

// One full ring of the sphere's orthogonal graticule, radius 1. Three.js axes
// map to Stokes axes as (x, y, z) = (S1, S3, S2) -- S3 vertical per the
// requested convention; S1/S2 split across the two horizontal axes since
// neither has a required orientation.
function graticuleRing(fixedAxis, segments = 96) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    if (fixedAxis === 's3') pts.push(new THREE.Vector3(c, 0, s));       // S1-S2 equator
    else if (fixedAxis === 's2') pts.push(new THREE.Vector3(c, s, 0));  // S1-S3 meridian
    else pts.push(new THREE.Vector3(0, c, s));                          // S2-S3 meridian
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

function AxisLabel({ text, position, size = 0.28 }) {
  const { texture, aspect } = useMemo(() => makeTextSpriteTexture(text), [text]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

// The state arrow's direction depends on theta/phi, but ThickArrowHelper only
// re-syncs when its imperative setDirection/setLength handle is called --
// passing a new `dir` prop alone won't move it (same reasoning as Axes()
// being static vs. FieldVectors driving its arrows imperatively). It has to
// be done with useFrame from *inside* the Canvas tree, not a useLayoutEffect
// in the component that renders the <Canvas>: R3F mounts a Canvas's children
// through its own reconciler on its own schedule, decoupled from the outer
// DOM tree's commit -- a useLayoutEffect up there fires before the arrow
// ref even exists yet, silently no-ops, and (since theta/phi may not change
// again) never gets a second chance.
function PoincareStateArrow({ theta, phi }) {
  const arrowRef = useRef();
  useFrame(() => {
    const { s1, s2, s3 } = stokesFromState(theta, phi);
    arrowRef.current?.setDirection(new THREE.Vector3(s1, s3, s2));
  });
  return (
    <ThickArrowHelper ref={arrowRef} dir={new THREE.Vector3(1, 0, 0)} origin={new THREE.Vector3(0, 0, 0)} length={1} color={0xcc0000} headLength={0.20} headWidth={0.12} shaftWidth={3.0} />
  );
}

const SPHERE_AXIS_EXTENT = 1.3;

function PoincareSphere({ theta, phi }) {
  const controlsRef = useRef();
  // Same reasoning as the wave animation's Home View button: not
  // controls.reset(), since target0/position0 get captured before drei
  // applies the `target` prop below, so reset() would snap to the wrong
  // point. Set both explicitly instead.
  const resetView = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(...SPHERE_INITIAL_CAMERA_POSITION);
    controls.target.set(...SPHERE_INITIAL_CAMERA_TARGET);
    controls.update();
  };

  const equator = useMemo(() => graticuleRing('s3'), []);
  const meridianA = useMemo(() => graticuleRing('s2'), []);
  const meridianB = useMemo(() => graticuleRing('s1'), []);

  return (
    // position: 'relative' + the button's position: 'absolute' below keeps
    // the button entirely out of the surrounding flex layout -- it overlays
    // the canvas rather than becoming a sibling flex item, so it can't
    // affect the heading/canvas alignment above it.
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: SPHERE_INITIAL_CAMERA_POSITION, fov: 35 }} style={{ width: '100%', height: '100%' }}>
        <mesh>
          <sphereGeometry args={[1, 32, 32]} />
          <meshBasicMaterial color="gray" transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>

        <Line points={equator} color="gray" lineWidth={1} dashed dashSize={0.06} gapSize={0.05} />
        <Line points={meridianA} color="gray" lineWidth={1} dashed dashSize={0.06} gapSize={0.05} />
        <Line points={meridianB} color="gray" lineWidth={1} dashed dashSize={0.06} gapSize={0.05} />

        <ThickArrowHelper dir={new THREE.Vector3(1, 0, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.15} headWidth={0.07} shaftWidth={1.5} />
        <ThickArrowHelper dir={new THREE.Vector3(0, 1, 0)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.15} headWidth={0.07} shaftWidth={1.5} />
        <ThickArrowHelper dir={new THREE.Vector3(0, 0, 1)} origin={new THREE.Vector3(0, 0, 0)} length={SPHERE_AXIS_EXTENT} color={0x000000} headLength={0.15} headWidth={0.07} shaftWidth={1.5} />

        <AxisLabel text="S₁" position={[SPHERE_AXIS_EXTENT + 0.2, 0, 0]} />
        <AxisLabel text="S₃" position={[0, SPHERE_AXIS_EXTENT + 0.2, 0]} />
        <AxisLabel text="S₂" position={[0, 0, SPHERE_AXIS_EXTENT + 0.2]} />

        <PoincareStateArrow theta={theta} phi={phi} />

        <OrbitControls ref={controlsRef} target={SPHERE_INITIAL_CAMERA_TARGET} />
      </Canvas>

      <button
        className="control-button"
        onClick={resetView}
        style={{
          position: 'absolute',
          bottom: '6px',
          left: '6px',
          width: '46px',
          height: '46px',
          padding: '2px',
          margin: 0,
          fontSize: '0.62rem',
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

/********** Main panel and App functions **********/

// export function SpherePanel({ controlBools }) {
//   const canvasRef = useRef(null);
//   const containerRef = useRef(null);
//   const [circle, setCircle] = useState({ x: 300, y: 200, radius: 8 });
//   const [draggingCircle, setDraggingCircle] = useState(false);
//   const [offset, setOffset] = useState({ x: 0, y: 0 });
//   const [circleColor, setCircleColor] = useState(false);
//   const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });

//   // Resize canvas to fill container
//   useEffect(() => {
//     const canvas = canvasRef.current;
//     const container = containerRef.current;
//     if (!canvas || !container) return;

//     const resizeCanvas = () => {
//       const newWidth = container.clientWidth;
//       const newHeight = container.clientHeight;
//       canvas.width = newWidth;
//       canvas.height = newHeight;
//       setCanvasDims({ width: newWidth, height: newHeight }); // Trigger redraw
//     };

//     resizeCanvas();
//     window.addEventListener('resize', resizeCanvas);
//     return () => window.removeEventListener('resize', resizeCanvas);
//   }, []);

//   // Drawing
//   useEffect(() => {
//     const canvas = canvasRef.current;
//     if (!canvas) return;

//     const ctx = canvas.getContext('2d');

//     // Clear canvas
//     ctx.fillStyle = '#ffffff';
//     ctx.fillRect(0, 0, canvas.width, canvas.height);

//     // Draw grid
//     ctx.strokeStyle = '#e0e0e0';
//     ctx.lineWidth = 1;
//     for (let i = 0; i <= canvas.width; i += 50) {
//       ctx.beginPath();
//       ctx.moveTo(i, 0);
//       ctx.lineTo(i, canvas.height);
//       ctx.stroke();
//     }
//     for (let i = 0; i <= canvas.height; i += 50) {
//       ctx.beginPath();
//       ctx.moveTo(0, i);
//       ctx.lineTo(canvas.width, i);
//       ctx.stroke();
//     }

//     // Draw circle
//     ctx.fillStyle = circleColor ? '#e74c3c' : '#39db34';
//     ctx.beginPath();
//     ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
//     ctx.fill();

//     // Draw circle outline
//     ctx.strokeStyle = circleColor ? '#c0392b' : '#2bb929';
//     ctx.lineWidth = 2;
//     ctx.stroke();
//   }, [circle, circleColor, canvasDims, controlBools]);

//   // Mouse handlers
//   const handleMouseDown = (e) => {
//     const canvas = canvasRef.current;
//     const rect = canvas.getBoundingClientRect();
//     const mouseX = e.clientX - rect.left;
//     const mouseY = e.clientY - rect.top;

//     const dist = Math.sqrt((mouseX - circle.x) ** 2 + (mouseY - circle.y) ** 2);

//     if (dist < circle.radius + 5) {
//       setDraggingCircle(true);
//       setOffset({
//         x: mouseX - circle.x,
//         y: mouseY - circle.y,
//       });
//     }
//   };

//   const handleMouseMove = (e) => {
//     if (!draggingCircle) return;

//     const canvas = canvasRef.current;
//     const rect = canvas.getBoundingClientRect();
//     const mouseX = e.clientX - rect.left;
//     const mouseY = e.clientY - rect.top;

//     setCircle({
//       ...circle,
//       x: Math.max(circle.radius, Math.min(canvas.width - circle.radius, mouseX - offset.x)),
//       y: Math.max(circle.radius, Math.min(canvas.height - circle.radius, mouseY - offset.y)),
//     });
//   };

//   const handleMouseUp = () => {
//     setDraggingCircle(false);
//   };

//   return (
//     <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
//       <canvas
//         ref={canvasRef}
//         onMouseDown={handleMouseDown}
//         onMouseMove={handleMouseMove}
//         onMouseUp={handleMouseUp}
//         onMouseLeave={handleMouseUp}
//         style={{
//           cursor: draggingCircle ? 'grabbing' : 'grab',
//           display: 'block',
//           touchAction: 'none',
//         }}
//       />
//     </div>
//   );
// }

export default function App() {
  const [controlBools, setControlBools] = useState({
    showSphere: true,             // Displaying the sphere
    advancedBField: false         // For when the user is specifying an advanced magnetic field
  });
  // Spin state at t = 0, set by two angles
  const [initialSpinState, setInitialSpinState] = useState({ theta: 0, phi: 0 });
  // Every element of this array should have a theta, phi, magnitude, and omega specifying it
  const [magneticField, setMagneticField] = useState([{ mag: 0, theta: 0, phi: 0, omega: 0 }]);

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        {/*<SpherePanel controlBools={controlBools} />*/}
        <PoincareSphere theta={0} phi={0} />
      </div>

      {/* Right Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-content">
          <div className="panel-controls">
            <div>
              <h3>Instructions and Controls</h3>
              <p>Drag the object or eye around and watch if and where a virtual image is visible!
              If desired, right-click in the simulation area to save an image of the current setup.
              Rotate the mirror and explore other controls below!</p>

              <div className="control-group" style={{ marginTop: '1.0em', marginBottom: '1.5em' }}>
                <label style={{ justifyContent: 'center' }}>Mirror angle: {(magneticField[0].theta * 180 / Math.PI).toFixed(1)}°</label>
                <input
                  type="range"
                  min={-Math.PI}
                  max={Math.PI}
                  step="0.01"
                  value={magneticField[0].theta}
                  onChange={(e) => setMagneticField([{ mag: 0, theta: e.target.value, phi: 0, omega: 0 }])}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="control-group" style={{ marginTop: '1.0em' }}>
                <button className={`control-button ${controlBools.showSphere ? 'active' : ''}`} onClick={() => setControlBools({ ...controlBools, showSphere: !controlBools.showSphere })}>
                  {controlBools.showSphere ? 'Hide sphere' : 'Show sphere'}
                </button>
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