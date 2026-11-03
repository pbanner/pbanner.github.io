// The symmetries of an arrangement of charges, and the field lines that
// those symmetries map onto each other. Plain JS, no React or three.js.
//
// Charges are placed on a cubic grid, so any symmetry an arrangement has
// is one of the cube's 48 -- reflections across the coordinate planes,
// swapping axes, quarter turns, and their combinations -- and it has to
// map the box to itself, so it's about the middle of the box. Each one
// permutes the coordinates and flips some of their signs:
// (T p)_i = signs[i] * p[perm[i]].
//
// fieldLines.js uses these so that symmetric lines are treated alike: when
// a negative point charge chooses which of its own lines to keep, it keeps
// or drops each "orbit" -- the set of lines the arrangement's symmetries
// map onto each other -- whole. Then a symmetric arrangement of point
// charges gets a symmetric picture.
import { CHARGE_SETTINGS, normalizePosition } from './chargeTypes.js';

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const ALL_SYMMETRIES = PERMS.flatMap((perm) => Array.from({ length: 8 }, (_, s) => ({
  perm,
  signs: [0, 1, 2].map((k) => ((s >> k) & 1 ? -1 : 1)),
})));

export const applySymmetry = (T, p) => [0, 1, 2].map((i) => T.signs[i] * p[T.perm[i]]);
// The axis that axis k turns into.
const mapAxis = (T, k) => T.perm.indexOf(k);

const close = (a, b) => Math.abs(a - b) < 1e-9;

function transformCharge(T, c) {
  const out = { ...c, position: applySymmetry(T, c.position) };
  if (c.kind === 'rod' || c.kind === 'plane') out.axis = mapAxis(T, c.axis);
  return normalizePosition(out);
}

function sameCharge(a, b) {
  if (a.kind !== b.kind) return false;
  if (!a.position.every((v, k) => close(v, b.position[k]))) return false;
  const key = CHARGE_SETTINGS[a.kind].key;
  if (!close(a[key], b[key])) return false;
  if (a.kind === 'point') return true;
  if (a.form !== b.form) return false;
  if ((a.kind === 'rod' || a.kind === 'plane') && a.axis !== b.axis) return false;
  if ((a.kind === 'sphere' || (a.kind === 'rod' && a.form !== 'line')) && !close(a.radius, b.radius)) return false;
  if (a.kind === 'plane' && a.form === 'slab' && !close(a.thickness, b.thickness)) return false;
  return true;
}

// The symmetries (including the identity) that map the arrangement onto
// itself -- every charge onto one just like it -- and, with a 2D cut
// ({ axis, offset }), the cut onto itself too.
export function arrangementSymmetries(charges, cut = null) {
  return ALL_SYMMETRIES.filter((T) => {
    if (cut) {
      if (mapAxis(T, cut.axis) !== cut.axis) return false;
      const p = [0, 0, 0];
      p[cut.axis] = cut.offset;
      if (!close(applySymmetry(T, p)[cut.axis], cut.offset)) return false;
    }
    const used = new Set();
    return charges.every((c) => {
      const image = transformCharge(T, c);
      const j = charges.findIndex((o, k) => !used.has(k) && sameCharge(image, o));
      if (j < 0) return false;
      used.add(j);
      return true;
    });
  });
}

// Orbits of seeds (where lines start) under the symmetries. seeds:
// [{ site, tag }] -- `site` a point that identifies the seed and that the
// symmetries move about (where it is, or for a seed whose position
// depends on its threshold, a point that doesn't), `tag` its category, so
// seeds of different kinds at the same place are told apart. A symmetry
// that doesn't map every seed onto another one (which the seed layouts
// are built to avoid) isn't used. Returns each seed's orbit number.
const siteKey = (tag, p) => `${tag}|${p.map((v) => Math.round(v * 1e6)).join(',')}`;
export function seedOrbits(seeds, symmetries) {
  const index = new Map(seeds.map((s, i) => [siteKey(s.tag, s.site), i]));
  const parent = seeds.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const T of symmetries) {
    const images = seeds.map((s) => index.get(siteKey(s.tag, applySymmetry(T, s.site))));
    if (images.some((j) => j === undefined)) continue;
    images.forEach((j, i) => {
      const [a, b] = [find(i), find(j)];
      if (a !== b) parent[a] = b;
    });
  }
  return seeds.map((_, i) => find(i));
}
