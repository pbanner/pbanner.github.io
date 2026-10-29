// The directions field lines start out in from each charge (fieldLines.js).
// Plain JS, no React.
//
// The picture can only be as symmetric as the starting directions. If an
// arrangement of charges looks the same after some reflection or rotation,
// its field does too -- but the drawn lines only will if each charge's
// starting directions also look the same after it. Charges snap to a cubic
// grid, so any symmetry an arrangement can have is one of the cube's 48
// (reflections across the coordinate planes, swapping axes, 90-degree
// rotations, and their combinations). So every set of starting directions
// is one that all 48 leave unchanged.
//
// Such a set is a union of "orbits": a direction together with every
// direction any of the 48 symmetries can turn it into, i.e. every
// permutation of its coordinates with every choice of signs. An orbit has
// one of only five sizes:
//    6  the axes, (1, 0, 0) and the like
//    8  the cube's corners, (1, 1, 1) and the like
//   12  the face diagonals, (1, 1, 0) and the like
//   24  any (a, b, 0) or (a, a, b) -- one free parameter
//   48  any other (a, b, c)
// Every size but 8 is a multiple of 6. So a set that includes the corners
// has 2 more than a multiple of 6 directions, and any multiple of that
// size is something no such set can have: e.g. 26 directions per unit
// charge, but no symmetric set of 52 for a charge of 2. Sets without the
// corners are multiples of 6, and every multiple of 6 is a possible size.
// So every set here leaves the corners out, which lets a charge of any
// size get its own symmetric set.
//
// The free parameters of each set's 24- and 48-orbits were chosen (offline)
// to spread the set's directions as evenly as possible: they minimize the
// "Thomson problem" energy, the sum of 1/distance over every pair of
// directions, as if each were a charge repelling the others on the unit
// sphere. Only one representative direction of each orbit is listed; the
// rest of the orbit follows from the symmetries, so the set is exactly
// symmetric however many digits the representative has.

function orbit(v) {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const norm = Math.hypot(...v);
  const seen = new Map();
  for (const perm of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const d = perm.map((axis, k) => ((signs >> k) & 1 ? -1 : 1) * v[axis] / norm);
      seen.set(d.map((c) => c.toFixed(9)).join(','), d.map((c) => c + 0)); // + 0 turns -0 into 0
    }
  }
  return [...seen.values()];
}

const AXES = [1, 0, 0];
const FACE_DIAGONALS = [1, 1, 0];

// Each set's orbit representatives, by the set's size.
const ORBIT_REPRESENTATIVES = {
  6: [AXES],
  18: [AXES, FACE_DIAGONALS],
  30: [AXES, [0.3940023686, 0.3940023686, 0.8303759794]],
  42: [AXES, FACE_DIAGONALS, [0.3850768575, 0.3850768575, 0.8387083091]],
  54: [AXES, [0, 0.4953983646, 0.8686659083], [0.4378328381, 0.4378328381, 0.785241881]],
};

// The density setting (1-5) picks how many lines each unit of charge gets.
// Each count includes the axes, so a charge always sends lines straight
// along x, y and z.
export const LINES_PER_UNIT_CHARGE = [6, 18, 30, 42, 54];

const cache = new Map();

// The symmetric set of `count` starting directions, as unit vectors.
export function seedDirections(count) {
  if (!cache.has(count)) {
    const reps = ORBIT_REPRESENTATIVES[count];
    if (!reps) throw new Error(`No symmetric set of ${count} starting directions`);
    const set = reps.flatMap(orbit);
    if (set.length !== count) throw new Error(`Starting-direction set ${count} has ${set.length} directions`);
    cache.set(count, set);
  }
  return cache.get(count);
}
