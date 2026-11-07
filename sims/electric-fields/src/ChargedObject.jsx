import { DoubleSide, FrontSide } from 'three';
import { Billboard, Line } from '@react-three/drei';
import { chargeColor } from './chargeTypes.js';
import { WORLD_HALF_EXTENT, SELECTION_COLOR, LINE_ROD_DRAWN_RADIUS as LINE_ROD_RADIUS } from './sceneConstants.js';

// A charged sphere, rod or plane in the scene (point charges are drawn by
// ChargeMarker). Red for positive, blue for negative, and see-through, so
// the field lines and arrows inside stay visible: the surfaces don't write
// to the depth buffer, so they never hide anything behind them, they only
// tint it. A shell or sheet (charge on a surface) is fainter than a solid
// or slab (charge filling a volume), so the two read differently, and each
// object gets outlines -- a sphere's equator, a rod's ends where it meets
// the box, a plane's edges -- to show its shape. Rods and planes are
// infinite, so they're drawn across the whole box.
//
// `selected` draws the outlines in the selection blue -- except a
// sphere's: its equator stays as it is, and it gets a blue outline around
// its edge as it looks from the camera, wherever that is -- and `ghost`
// draws the whole thing fainter, for the placement preview.

const SURFACE_OPACITY = 0.14; // shells and sheets
const VOLUME_OPACITY = 0.3; // solids and slabs
const GHOST_FADE = 0.6;
const SPAN = 2 * WORLD_HALF_EXTENT; // a rod's length or a plane's width: the box's

// Points around a circle of radius r in the plane perpendicular to `axis`
// (0, 1 or 2), centered on the origin, closed (last point = first).
function circlePoints(r, axis, n = 72) {
  const [u, v] = [0, 1, 2].filter((k) => k !== axis);
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    const p = [0, 0, 0];
    p[u] = r * Math.cos(t);
    p[v] = r * Math.sin(t);
    points.push(p);
  }
  return points;
}

// three's cylinders run along y; these turn one to run along x, y or z.
const ALONG_AXIS = [[0, 0, -Math.PI / 2], [0, 0, 0], [Math.PI / 2, 0, 0]];
// three's planes face along z; these turn one to face along x, y or z.
const FACING_AXIS = [[0, Math.PI / 2, 0], [Math.PI / 2, 0, 0], [0, 0, 0]];

function Surface({ color, solid, ghost, children }) {
  const opacity = (solid ? VOLUME_OPACITY : SURFACE_OPACITY) * (ghost ? GHOST_FADE : 1);
  return (
    <mesh>
      {children}
      <meshStandardMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        // A shell or sheet shows its far side through its near side; a
        // solid shows only its outside.
        side={solid ? FrontSide : DoubleSide}
        roughness={0.6}
      />
    </mesh>
  );
}

function Outline({ points, segments = false, color, selected }) {
  return <Line points={points} segments={segments} color={color} lineWidth={selected ? 2.5 : 1.2} transparent opacity={selected ? 1 : 0.7} />;
}

function Sphere({ charge, color, outlineColor, selected, ghost }) {
  const { radius, form } = charge;
  return (
    <group position={charge.position}>
      <Surface color={color} solid={form === 'solid'} ghost={ghost}>
        <sphereGeometry args={[radius, 48, 32]} />
      </Surface>
      <Outline points={circlePoints(radius, 2)} color={color} />
      {/* A circle around the sphere, turned to face the camera every frame
          (Billboard): its edge, as it looks from wherever the camera is.
          (Strictly, in perspective the visible edge is a little smaller --
          by under 5% even close up -- so this sits just outside it.) */}
      {selected && (
        <Billboard>
          <Outline points={circlePoints(radius, 2)} color={outlineColor} selected />
        </Billboard>
      )}
    </group>
  );
}

function Rod({ charge, color, outlineColor, selected, ghost }) {
  const { axis, radius, form } = charge;
  if (form === 'line') {
    return (
      <group position={charge.position} rotation={ALONG_AXIS[axis]}>
        <mesh>
          <cylinderGeometry args={[LINE_ROD_RADIUS, LINE_ROD_RADIUS, SPAN, 16]} />
          <meshStandardMaterial color={color} roughness={0.4} transparent={ghost} opacity={ghost ? GHOST_FADE : 1} />
        </mesh>
        {/* Selected: a blue sleeve around the thin rod. */}
        {selected && (
          <mesh>
            <cylinderGeometry args={[2.4 * LINE_ROD_RADIUS, 2.4 * LINE_ROD_RADIUS, SPAN, 24, 1, true]} />
            <meshBasicMaterial color={SELECTION_COLOR} transparent opacity={0.35} depthWrite={false} side={DoubleSide} />
          </mesh>
        )}
      </group>
    );
  }
  // Where the rod's surface meets the two faces of the box it crosses.
  const ends = [-1, 1].map((s) => circlePoints(radius, axis).map((p) => {
    const q = [...p];
    q[axis] = s * WORLD_HALF_EXTENT;
    return q;
  }));
  return (
    <group position={charge.position}>
      <group rotation={ALONG_AXIS[axis]}>
        <Surface color={color} solid={form === 'solid'} ghost={ghost}>
          <cylinderGeometry args={[radius, radius, SPAN, 48, 1, form !== 'solid']} />
        </Surface>
      </group>
      {ends.map((points, i) => <Outline key={i} points={points} color={outlineColor} selected={selected} />)}
    </group>
  );
}

function Plane({ charge, color, outlineColor, selected, ghost }) {
  const { axis, form, thickness } = charge;
  const h = WORLD_HALF_EXTENT;
  const [u, v] = [0, 1, 2].filter((k) => k !== axis);
  // The outline of the face at offset d along the axis: a square loop.
  const square = (d) => [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([a, b]) => {
    const p = [0, 0, 0];
    p[axis] = d;
    p[u] = a;
    p[v] = b;
    return p;
  });
  if (form === 'slab') {
    const size = [SPAN, SPAN, SPAN];
    size[axis] = thickness;
    const [near, far] = [square(-thickness / 2), square(thickness / 2)];
    // The slab's edges: both square faces, and the four edges between them.
    const sides = [0, 1, 2, 3].flatMap((i) => [near[i], far[i]]);
    return (
      <group position={charge.position}>
        <Surface color={color} solid ghost={ghost}>
          <boxGeometry args={size} />
        </Surface>
        <Outline points={near} color={outlineColor} selected={selected} />
        <Outline points={far} color={outlineColor} selected={selected} />
        <Outline points={sides} segments color={outlineColor} selected={selected} />
      </group>
    );
  }
  return (
    <group position={charge.position}>
      <group rotation={FACING_AXIS[axis]}>
        <Surface color={color} ghost={ghost}>
          <planeGeometry args={[SPAN, SPAN]} />
        </Surface>
      </group>
      <Outline points={square(0)} color={outlineColor} selected={selected} />
    </group>
  );
}

const DRAWERS = { sphere: Sphere, rod: Rod, plane: Plane };

export default function ChargedObject({ charge, selected = false, ghost = false }) {
  const Drawer = DRAWERS[charge.kind];
  const color = chargeColor(charge);
  return <Drawer charge={charge} color={color} outlineColor={selected ? SELECTION_COLOR : color} selected={selected} ghost={ghost} />;
}
