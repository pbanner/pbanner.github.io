// The electric field of everything placed in the scene: point charges and
// the charged objects (spheres, rods and planes). Plain JS, no React or
// three.js.
//
// Units: lengths in world units (the readout and the properties panel show
// ticks, 1 tick = SNAP_STEP world units), and the Coulomb constant set to
// 1, so a charge q gives E = q / r^2. The objects' charges are stored the
// way the panel shows them, per tick: a rod's lambda in q per tick of
// length, a plane's sigma in q per tick^2 of area. They're converted to
// per world unit here.
//
// Every object is uniformly charged and fixed in place (an insulator), and
// rods and planes are infinite, so each one's field has an exact formula
// from Gauss's law:
//
//   point charge q         q / r^2, outward
//   sphere, total charge Q   outside: Q / r^2, as if all of Q were at the
//                            center; inside a shell: 0; inside a solid
//                            ball: Q r / R^3 (only the charge closer to
//                            the center than r counts)
//   rod, lambda per length   outside (and everywhere, for a thin line):
//                            2 lambda / s, s the distance from the axis;
//                            inside a shell: 0; inside a solid cylinder:
//                            2 lambda s / R^2
//   plane, sigma per area    outside: 2 pi sigma, the same at any
//                            distance; inside a slab of thickness t:
//                            2 pi sigma (2 d / t), d the distance from
//                            its middle
// all pointing away from positive charge and toward negative.
import { SNAP_STEP } from './geometry.js';

const TICK = SNAP_STEP;

// An object's field at p, as [x, y, z].
export function objectField(obj, p) {
  switch (obj.kind) {
    case 'point':
      return inverseSquare(obj.q, obj.position, p, 0);
    case 'sphere':
      return sphereField(obj, p);
    case 'rod':
      return rodField(obj, p);
    case 'plane':
      return planeField(obj, p);
    default:
      throw new Error(`Unknown object kind: ${obj.kind}`);
  }
}

// q (d / |d|^3), d from `center` to p; 0 at the center itself, or (for a
// solid ball of radius `solidRadius`) q d / R^3 inside it.
function inverseSquare(q, center, p, solidRadius) {
  const dx = p[0] - center[0];
  const dy = p[1] - center[1];
  const dz = p[2] - center[2];
  const r2 = dx * dx + dy * dy + dz * dz;
  if (r2 === 0) return [0, 0, 0];
  const s = r2 < solidRadius * solidRadius ? q / solidRadius ** 3 : q / (r2 * Math.sqrt(r2));
  return [s * dx, s * dy, s * dz];
}

function sphereField(obj, p) {
  const { position: c, radius: R, form, q } = obj;
  if (form === 'shell') {
    const r2 = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (r2 < R * R) return [0, 0, 0];
    return inverseSquare(q, c, p, 0);
  }
  return inverseSquare(q, c, p, R);
}

function rodField(obj, p) {
  const { position: c, axis, radius: R, form, lambda } = obj;
  const lam = lambda / TICK; // q per world unit of length
  const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  d[axis] = 0; // from the axis, straight out
  const s2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (s2 === 0) return [0, 0, 0];
  let k;
  if (form !== 'line' && s2 < R * R) k = form === 'shell' ? 0 : (2 * lam) / (R * R);
  else k = (2 * lam) / s2;
  return [k * d[0], k * d[1], k * d[2]];
}

function planeField(obj, p) {
  const { position: c, axis, form, thickness, sigma } = obj;
  const sig = sigma / (TICK * TICK); // q per world unit of area
  const d = p[axis] - c[axis];
  let e;
  if (form === 'slab' && Math.abs(d) < thickness / 2) e = 2 * Math.PI * sig * ((2 * d) / thickness);
  else e = 2 * Math.PI * sig * Math.sign(d);
  const field = [0, 0, 0];
  field[axis] = e;
  return field;
}

// The total field at p of every object.
export function fieldAt(p, objects) {
  let ex = 0;
  let ey = 0;
  let ez = 0;
  for (const obj of objects) {
    const [x, y, z] = objectField(obj, p);
    ex += x;
    ey += y;
    ez += z;
  }
  return [ex, ey, ez];
}
