// The electric field of everything placed in the scene: point charges and
// the charged objects (spheres, rods and planes). Plain JS, no React or
// three.js.
//
// Units: lengths in world units (the readout and the properties panel show
// cm, 1 cm = SNAP_STEP world units: see geometry.js's CM), charges in nC,
// and the Coulomb constant set to 1, so a charge q gives E = q / r^2. The
// objects' charges are stored the way the panel shows them, per cm: a
// rod's lambda in nC per cm of length, a plane's sigma in nC per cm^2 of
// area. They're converted to per world unit here.
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
import { CM } from './geometry.js';

// The field in kN/C, for the probes' readings. With the Coulomb constant
// k, 1 nC at 1 cm makes k (1e-9 C) / (0.01 m)^2 = 89.9 kN/C. Here, 1 nC at
// 1 world unit makes a field of 1, and a world unit is 1 / CM cm, so a
// field of 1 here is CM^2 times that: 22.5 kN/C.
const COULOMB_CONSTANT = 8.9875517923e9; // N m^2 / C^2
const KILONEWTONS_PER_COULOMB = (COULOMB_CONSTANT * 1e-9) / 0.01 ** 2 / 1000 * CM ** 2;
export const toKilonewtonsPerCoulomb = (field) => field.map((c) => c * KILONEWTONS_PER_COULOMB);

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
  const lam = lambda / CM; // nC per world unit of length
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
  const sig = sigma / (CM * CM); // nC per world unit of area
  const d = p[axis] - c[axis];
  let e;
  if (form === 'slab' && Math.abs(d) < thickness / 2) e = 2 * Math.PI * sig * ((2 * d) / thickness);
  else e = 2 * Math.PI * sig * Math.sign(d);
  const field = [0, 0, 0];
  field[axis] = e;
  return field;
}

// What the field of `objects` depends on, as a string: each one's kind,
// place, charge, size and shape. Two arrangements with the same key have
// the same field everywhere -- so the field lines needn't be traced again
// when something else changes, like a free charge's velocity or a display
// option.
export function fieldKey(objects) {
  return JSON.stringify(objects.map((c) => [c.id, c.kind, c.position, c.q, c.lambda, c.sigma, c.radius, c.form, c.axis, c.thickness]));
}

// The sum of the first `count` of `terms` (reordering them), added up so
// that terms that are exact opposites cancel exactly, in any order.
//
// That matters for symmetric arrangements. In the middle of a square of
// charges, say, the charges' sideways pulls cancel exactly -- but added up
// one by one, in whatever order the charges were placed, a running total
// can round (-c - 2c needs one more binary digit than c has), and leave a
// "zero" of 1e-17 instead. If the free charge's position is unstable (as
// Earnshaw's theorem says some direction always is), that speck of
// rounding then grows exponentially, until the charge veers off for no
// reason anyone could see -- and only for some placement orders. A
// mirror-image charge's term, though, is the exact opposite of its twin's
// (the same numbers, one sign flipped), so here the terms are sorted by
// size, and each group of the same size is added as one number: how many
// more of them are positive than negative, times their size. Twins then
// cancel to exactly 0, and the total is the same whatever order the terms
// came in. A symmetric arrangement stays exactly symmetric, and a run
// doesn't depend on the order the charges were placed in.
//
// (An insertion sort: the lists are short, one term per charge.)
export function balancedSum(terms, count) {
  for (let k = 1; k < count; k++) {
    const v = terms[k];
    const size = Math.abs(v);
    let j = k - 1;
    while (j >= 0 && Math.abs(terms[j]) > size) {
      terms[j + 1] = terms[j];
      j--;
    }
    terms[j + 1] = v;
  }
  let sum = 0;
  let k = 0;
  while (k < count) {
    const size = Math.abs(terms[k]);
    let net = 0; // how many more of this size are positive than negative
    while (k < count && Math.abs(terms[k]) === size) {
      net += Math.sign(terms[k]);
      k++;
    }
    sum += net * size;
  }
  return sum;
}

// The total field at p of every object, added up one by one: the fast
// sum, for the field-line tracer (fieldLines.js), which calls it a great
// many times, and for which a field that cancels exactly needs no exact 0
// (a line stops short of where the field vanishes anyway).
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

// The same total field, each axis added up by balancedSum instead, so it's
// exactly 0 where the objects' fields cancel exactly -- the middle of a
// symmetric arrangement -- rather than a speck of rounding pointing
// whichever way, which an arrow drawn from it (a probe's, a free charge's
// force, the grid of field arrows) would show at full size. For fields
// read at one point at a time; a little slower than fieldAt. (The terms go
// in scratch arrays kept from call to call, grown as needed.)
let scratch = [new Float64Array(16), new Float64Array(16), new Float64Array(16)];
export function balancedFieldAt(p, objects) {
  if (objects.length > scratch[0].length) {
    scratch = [0, 1, 2].map(() => new Float64Array(2 * objects.length));
  }
  const [tx, ty, tz] = scratch;
  for (let k = 0; k < objects.length; k++) {
    const [x, y, z] = objectField(objects[k], p);
    tx[k] = x;
    ty[k] = y;
    tz[k] = z;
  }
  return [balancedSum(tx, objects.length), balancedSum(ty, objects.length), balancedSum(tz, objects.length)];
}
