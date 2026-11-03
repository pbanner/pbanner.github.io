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

// Each set's orbit representatives, by the set's size: every multiple of
// each density level's lines per unit charge, up to MAX_CHARGE times it.
const ORBIT_REPRESENTATIVES = {
  6: [AXES],
  12: [FACE_DIAGONALS],
  18: [AXES, FACE_DIAGONALS],
  24: [[0.3506413145, 0.3506413145, 0.8683900835]],
  30: [AXES, [0.3940023686, 0.3940023686, 0.8303759794]],
  36: [FACE_DIAGONALS, [0.3204118674, 0.3204118674, 0.8914440366]],
  42: [AXES, FACE_DIAGONALS, [0.3850768575, 0.3850768575, 0.8387083091]],
  54: [AXES, [0, 0.4953983646, 0.8686659083], [0.4378328381, 0.4378328381, 0.785241881]],
  60: [FACE_DIAGONALS, [0, 0.3228974692, 0.9464339514], [0.4435646225, 0.4435646225, 0.7787816455]],
  72: [[0, 0.5651032217, 0.8250202112], [0.2091144726, 0.2091144726, 0.9552707861], [0.4621781715, 0.4621781715, 0.7568240718]],
  84: [FACE_DIAGONALS, [0, 0.2964170375, 0.9550586055], [0.3559297457, 0.6608002785, 0.6608002785], [0.349914955, 0.349914955, 0.8689758619]],
  90: [AXES, FACE_DIAGONALS, [0, 0.3829995625, 0.9237485238], [0.3490806909, 0.3490806909, 0.8696466768], [0.3654536967, 0.6581958658, 0.6581958658]],
  108: [FACE_DIAGONALS, [0, 0.2376475814, 0.9713514436], [0.3991884911, 0.6483242046, 0.6483242046], [0.2157498187, 0.4655242453, 0.8583351285]],
  120: [[0.1582685474, 0.1582685474, 0.9746292289], [0.485863608, 0.485863608, 0.7265487656], [0.1761652992, 0.6960480541, 0.6960480541], [0.1725196884, 0.4532279932, 0.874540647]],
  126: [AXES, [0, 0.3167088994, 0.9485227847], [0.4924471995, 0.4924471995, 0.7176290904], [0.3068805142, 0.3068805142, 0.9009154788], [0.1677137533, 0.5845386888, 0.7938429431]],
  150: [AXES, [0.4038318747, 0.4038318747, 0.8208773562], [0.417136338, 0.6426497007, 0.6426497007], [0.1291596732, 0.3199166751, 0.9386006072], [0.1443540501, 0.5879518574, 0.7959111267]],
  162: [AXES, FACE_DIAGONALS, [0, 0.2678058977, 0.9634728855], [0.4846882849, 0.4846882849, 0.7281171148], [0.3030276822, 0.6738598607, 0.6738598607], [0.2920680346, 0.2920680346, 0.9107099024], [0.1529268479, 0.506663032, 0.8484727168]],
  168: [[0, 0.2017645443, 0.9794340553], [0, 0.4766749313, 0.879079638], [0.1311370334, 0.7010003846, 0.7010003846], [0.260130212, 0.260130212, 0.929873403], [0.438070232, 0.6356471002, 0.6356471002], [0.2873223459, 0.5013110698, 0.8161697622]],
  210: [AXES, FACE_DIAGONALS, [0, 0.2269836654, 0.9738985654], [0, 0.5048686661, 0.8631961712], [0.4475721629, 0.6323286958, 0.6323286958], [0.4265605157, 0.4265605157, 0.7975539185], [0.193557095, 0.3584736581, 0.9132536819], [0.2300730337, 0.589886809, 0.7740154725]],
  216: [[0, 0.3903200436, 0.9206792403], [0, 0.6127777643, 0.7902552825], [0, 0.1692097855, 0.9855800569], [0.4475679742, 0.6323301782, 0.6323301782], [0.2271570387, 0.6886216958, 0.6886216958], [0.4373009042, 0.4373009042, 0.7858344854], [0.2502389737, 0.2502389737, 0.9352865401], [0.2173397559, 0.4870368416, 0.8459069367]],
  270: [AXES, [0, 0.2255653343, 0.9742280431], [0, 0.576987101, 0.8167532585], [0.136089247, 0.700528271, 0.700528271], [0.4667645758, 0.4667645758, 0.7511735229], [0.3450074158, 0.3450074158, 0.8728916119], [0.2055611401, 0.2055611401, 0.9568120167], [0.4419965538, 0.6342866254, 0.6342866254], [0.1227554189, 0.4178296325, 0.9001941487], [0.2652759692, 0.5608644753, 0.7842574198]],
};

// The density setting (1-5) picks how many lines each unit of charge gets.
// Each of these includes the axes, so a unit charge always sends lines
// straight along x, y and z. (A bigger charge's set includes them only if
// its size is an odd multiple of 6: every orbit but the axes has a
// multiple of 12 directions.)
export const LINES_PER_UNIT_CHARGE = [6, 18, 30, 42, 54];

// The order in which to take `directions` (unit vectors) so that those
// taken first are spread out as evenly as possible: "farthest-point"
// order -- starting from the first, each next one is whichever is
// farthest from all those taken so far (its nearest one is farthest
// away). A symmetric set has many ties for farthest, and they go to the
// one least crowded overall: the smallest sum, over those taken, of
// 1 / (1 - cos(angle)), a "repulsion" like that between charges. (Taking
// the first in the list instead piled them up on one side: of 24 around
// a circle, after the axes and diagonals, the next four all fell in one
// quarter.) Returns each direction's rank: 0 for the first taken, 1 for
// the next, ...
const TIE = 1e-9;
export function spreadOrder(directions) {
  const n = directions.length;
  const rank = new Array(n);
  const closest = new Array(n).fill(-Infinity); // largest dot product with any direction taken so far
  const repulsion = new Array(n).fill(0);
  let next = 0;
  for (let r = 0; r < n; r++) {
    rank[next] = r;
    const t = directions[next];
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (rank[i] !== undefined) continue;
      const d = directions[i];
      const c = d[0] * t[0] + d[1] * t[1] + d[2] * t[2];
      closest[i] = Math.max(closest[i], c);
      repulsion[i] += 1 / (1 - c + 1e-6);
      if (best < 0 || closest[i] < closest[best] - TIE
        || (closest[i] <= closest[best] + TIE && repulsion[i] < repulsion[best] - TIE)) best = i;
    }
    next = best;
  }
  return rank;
}

const cache = new Map();

function build(count) {
  if (!cache.has(count)) {
    const reps = ORBIT_REPRESENTATIVES[count];
    if (!reps) throw new Error(`No symmetric set of ${count} starting directions`);
    const orbits = reps.map(orbit);
    const directions = orbits.flat();
    if (directions.length !== count) throw new Error(`Starting-direction set ${count} has ${directions.length} directions`);
    // Each direction's threshold (see seedThresholds): its place in
    // spreadOrder, as a fraction of the set.
    const thresholds = spreadOrder(directions).map((rank) => (rank + 0.5) / count);
    cache.set(count, { directions, thresholds });
  }
  return cache.get(count);
}

// The symmetric set of `count` starting directions, as unit vectors.
export function seedDirections(count) {
  return build(count).directions;
}

// A number from 0 to 1 for each of seedDirections(count)'s directions,
// spread evenly over 0..1 -- so of all the lines, the fraction whose
// threshold is below any value v is v, to within one line -- and in an
// order that spreads out over the sphere: the directions with thresholds
// below any v are about as evenly spread as v x count directions can be.
// fieldLines.js compares a line's threshold with the fraction of its flux
// still going, to decide where it ends inside a negatively charged object;
// so where some fraction of a charge's lines end, as many do as should,
// and they're spread around evenly, without favoring any side. (They
// can't always be exactly symmetric: e.g. 30 of a 60-line set, whose
// orbits have 12, 24 and 24 directions.)
export function seedThresholds(count) {
  return build(count).thresholds;
}
