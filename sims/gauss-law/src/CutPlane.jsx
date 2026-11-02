import { DoubleSide } from 'three';
import { Line } from '@react-three/drei';
import { WORLD_HALF_EXTENT, CHARGE_RADIUS, SELECTION_COLOR } from './sceneConstants.js';

// The 2D cut in the 3D scene (see cutPlanes.js): a gray-tinted square
// across the box with a dashed outline -- a "knife", not a charge, so
// unlike a charged plane it isn't colored by sign. Selected, its outline
// is blue; invalid (the charges aren't mirror-symmetric through it any
// more), it turns orange.
//
// It also outlines, in dark gray, what the cut slices through, so it's
// clear before viewing it what the cut will show: a ring around each point
// charge lying in it, a circle where it cuts a sphere or crosses a rod,
// the edges of a rod lying in it, and a line where it crosses a charged
// plane (two for a slab).

const TINT = '#8a919b';
const OUTLINE = '#5b616a';
const INVALID = '#e8890c';
const SLICE = '#3a3f46';
const H = WORLD_HALF_EXTENT;

// Points around a circle of radius r centered at `center`, in the plane
// perpendicular to `axis`, closed.
function circle(center, r, axis, n = 64) {
  const [u, v] = [0, 1, 2].filter((k) => k !== axis);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    const p = [...center];
    p[u] += r * Math.cos(t);
    p[v] += r * Math.sin(t);
    return p;
  });
}

// A segment across the whole box, in the cut (axis `cutAxis` at
// `offset`), along `along`, at coordinate `at` on the remaining axis.
function across(cutAxis, offset, along, at) {
  const other = [0, 1, 2].find((k) => k !== cutAxis && k !== along);
  return [-H, H].map((s) => {
    const p = [0, 0, 0];
    p[cutAxis] = offset;
    p[along] = s;
    p[other] = at;
    return p;
  });
}

// What the cut at `offset` along `axis` slices through each charge, as a
// list of polylines.
function slices(charges, axis, offset) {
  const lines = [];
  const onCut = (p) => {
    const q = [...p];
    q[axis] = offset;
    return q;
  };
  for (const c of charges) {
    const d = c.position[axis] - offset;
    if (c.kind === 'point') {
      if (Math.abs(d) < 1e-6) lines.push(circle(c.position, 1.8 * CHARGE_RADIUS, axis, 32));
    } else if (c.kind === 'sphere') {
      if (Math.abs(d) < c.radius) lines.push(circle(onCut(c.position), Math.sqrt(c.radius ** 2 - d ** 2), axis));
    } else if (c.kind === 'rod') {
      const r = c.form === 'line' ? 0 : c.radius;
      if (c.axis === axis) {
        lines.push(circle(onCut(c.position), Math.max(r, 1.8 * CHARGE_RADIUS), axis, 32));
      } else if (Math.abs(d) < r || (r === 0 && Math.abs(d) < 1e-6)) {
        // Lying across the cut: where its surface meets it, either side of
        // its axis (just the axis, for a thin rod).
        const other = [0, 1, 2].find((k) => k !== axis && k !== c.axis);
        const half = Math.sqrt(Math.max(0, r ** 2 - d ** 2));
        for (const s of half > 0 ? [-half, half] : [0]) lines.push(across(axis, offset, c.axis, c.position[other] + s));
      }
    } else if (c.kind === 'plane' && c.axis !== axis) {
      const along = [0, 1, 2].find((k) => k !== axis && k !== c.axis);
      const half = c.form === 'slab' ? c.thickness / 2 : 0;
      for (const s of half > 0 ? [-half, half] : [0]) {
        // `across` puts the segment at a coordinate on the remaining axis,
        // which here is the charged plane's own axis.
        lines.push(across(axis, offset, along, c.position[c.axis] + s));
      }
    }
  }
  return lines;
}

// cut: where the cut is, { axis, offset, valid } (cutPlanes.js's
// placeCut). charges: everything placed, for the slices.
export default function CutPlane({ cut, charges, selected }) {
  const { axis, offset, valid } = cut;
  const [u, v] = [0, 1, 2].filter((k) => k !== axis);
  const corner = (a, b) => {
    const p = [0, 0, 0];
    p[axis] = offset;
    p[u] = a;
    p[v] = b;
    return p;
  };
  const square = [corner(-H, -H), corner(H, -H), corner(H, H), corner(-H, H), corner(-H, -H)];
  const position = [0, 0, 0];
  position[axis] = offset;
  // three's planes face along z; these turn one to face along x, y or z.
  const rotation = [[0, Math.PI / 2, 0], [Math.PI / 2, 0, 0], [0, 0, 0]][axis];
  const outline = !valid ? INVALID : selected ? SELECTION_COLOR : OUTLINE;
  return (
    <group>
      <mesh position={position} rotation={rotation}>
        <planeGeometry args={[2 * H, 2 * H]} />
        <meshBasicMaterial color={valid ? TINT : INVALID} transparent opacity={0.12} depthWrite={false} side={DoubleSide} />
      </mesh>
      <Line points={square} color={outline} lineWidth={selected ? 2.2 : 1.6} dashed dashSize={0.3} gapSize={0.2} />
      {slices(charges, axis, offset).map((points, i) => (
        <Line key={i} points={points} color={SLICE} lineWidth={1.4} transparent opacity={0.8} />
      ))}
    </group>
  );
}
