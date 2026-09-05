// Two-particle spin-1/2 physics for an entangled pair -- lives in its own
// module (like colors.js) so LabPanel's Monte-Carlo particle simulation and
// Histogram's exact theoretical-probability overlay compute against the
// exact same tested math, rather than maintaining two independently
// implemented models of the same quantum mechanics. The single-particle
// building blocks below (complex arithmetic, eigenstates) are carried over
// unchanged from the Stern-Gerlach sim's physics.js -- entanglement only
// changes what happens *between* the two particles, which is confined to
// the joint-state section at the bottom of this file.

// Complex arithmetic on plain { re, im } objects -- no library needed for
// just add/multiply/scale/modulus/conjugate.
export function cAdd(z1, z2) { return { re: z1.re + z2.re, im: z1.im + z2.im }; }
export function cMul(z1, z2) { return { re: z1.re * z2.re - z1.im * z2.im, im: z1.re * z2.im + z1.im * z2.re }; }
export function cScale(z, s) { return { re: z.re * s, im: z.im * s }; }
export function cExp(theta) { return { re: Math.cos(theta), im: Math.sin(theta) }; } // e^{i*theta}
export function cAbs2(z) { return z.re * z.re + z.im * z.im; }
export function cConj(z) { return { re: z.re, im: -z.im }; }

// A single spin-1/2's +1/-1 eigenstates for the axis pointing at (theta,
// phi) on the Bloch sphere, expressed as { a, b } components on the fixed
// Z-basis {|up_Z>, |down_Z>} -- i.e. a = <up_Z|state>, b = <down_Z|state>.
// Every basis (Z, X, Y, or an arbitrary n_hat) is just a different (theta,
// phi), so one pair of formulas covers all of them.
export function upEigenstate(theta, phi) {
  return { a: { re: Math.cos(theta / 2), im: 0 }, b: cScale(cExp(phi), Math.sin(theta / 2)) };
}
export function downEigenstate(theta, phi) {
  return { a: cScale(cExp(-phi), -Math.sin(theta / 2)), b: { re: Math.cos(theta / 2), im: 0 } };
}

// --- Pair sources ---------------------------------------------------------
// What the oven emits each pair in is no longer fixed to the singlet --
// App.jsx's Source Controls sidebar lets it pick from three kinds, each
// represented here as a plain `source` object:
//
//   { kind: 'classical', weights: {uu,ud,du,dd} } -- see jointProbabilitiesClassical.
//                                                   weights are relative, not
//                                                   pre-normalized (same "up
//                                                   to normalization" contract
//                                                   as a quantum source's
//                                                   coeffs below) -- {1,0,0,1}
//                                                   and {3,0,0,3} both mean
//                                                   "50/50 up-up/down-down".
//   { kind: 'quantum', coeffs: {uu,ud,du,dd} }   -- a 2-qubit state, as four
//                                                   complex coefficients on
//                                                   the Z-basis product
//                                                   states {L,R} in
//                                                   {up,down}^2. Renormalized
//                                                   before use (see
//                                                   normalizedCoeffs), so a
//                                                   caller -- the custom-state
//                                                   UI in particular -- never
//                                                   has to pre-normalize its
//                                                   own input.
//   { kind: 'instructionSets', relationship, particle1, particle2 } -- Bell's
//                                                   own local-hidden-variable
//                                                   model: each particle
//                                                   carries a predetermined
//                                                   answer for every one of a
//                                                   handful of user-chosen
//                                                   analyzer directions. See
//                                                   the "Hidden instruction
//                                                   sets" section below for
//                                                   the full shape.
//
// The four Bell states and the user-specified custom state are both
// 'quantum', just with different coeffs; BELL_STATES below is every
// 'quantum' source this sim ships as a preset.

const ZERO = { re: 0, im: 0 };
const INV_SQRT2 = { re: 1 / Math.SQRT2, im: 0 };
const NEG_INV_SQRT2 = { re: -1 / Math.SQRT2, im: 0 };

// The four Bell states -- an orthonormal basis of maximally-entangled
// two-qubit states, of which the singlet (psiMinus, this sim's original and
// still-default source) is one. `terms` describes each state's own up/down-Z
// decomposition for display (App.jsx's Ket component renders it), kept as
// plain data here rather than JSX so this file stays free of any UI
// dependency: each entry is either an ['up'|'down', 'up'|'down'] pair (one
// ket) or a bare '+'/'-' (the operator between two kets).
export const BELL_STATES = [
  {
    key: 'phiPlus', letter: 'Φ', sign: '+',
    coeffs: { uu: INV_SQRT2, ud: ZERO, du: ZERO, dd: INV_SQRT2 },
    terms: [['up', 'up'], '+', ['down', 'down']],
  },
  {
    key: 'phiMinus', letter: 'Φ', sign: '-',
    coeffs: { uu: INV_SQRT2, ud: ZERO, du: ZERO, dd: NEG_INV_SQRT2 },
    terms: [['up', 'up'], '-', ['down', 'down']],
  },
  {
    key: 'psiPlus', letter: 'Ψ', sign: '+',
    coeffs: { uu: ZERO, ud: INV_SQRT2, du: INV_SQRT2, dd: ZERO },
    terms: [['up', 'down'], '+', ['down', 'up']],
  },
  {
    key: 'psiMinus', letter: 'Ψ', sign: '-',
    coeffs: { uu: ZERO, ud: INV_SQRT2, du: NEG_INV_SQRT2, dd: ZERO },
    terms: [['up', 'down'], '-', ['down', 'up']],
  },
];

// psiMinus is the singlet this sim always emitted before Source Controls
// existed -- kept as the default so a fresh load behaves exactly as before.
export const DEFAULT_SOURCE = { kind: 'quantum', coeffs: BELL_STATES[3].coeffs };

// Rescales a set of quantum coefficients so |uu|^2+|ud|^2+|du|^2+|dd|^2 = 1,
// leaving their *relative* sizes (and so the physical state) unchanged --
// what makes "up to normalization" in the custom-state UI actually true:
// (1,0,0,1) and (3,0,0,3) describe the same state, and both work.
function normalizedCoeffs(coeffs) {
  const total = cAbs2(coeffs.uu) + cAbs2(coeffs.ud) + cAbs2(coeffs.du) + cAbs2(coeffs.dd);
  if (total === 0) return coeffs; // degenerate all-zero input -- samplePairOutcome's own fallback covers this
  const scale = 1 / Math.sqrt(total);
  return {
    uu: cScale(coeffs.uu, scale),
    ud: cScale(coeffs.ud, scale),
    du: cScale(coeffs.du, scale),
    dd: cScale(coeffs.dd, scale),
  };
}

// <outcomeL, outcomeR | psi> for a 'quantum' source's (already normalized)
// coefficients, where outcomeL and outcomeR are each the analyzer's own
// +n_hat/-n_hat eigenstate (from upEigenstate/downEigenstate) for whatever
// basis that analyzer is set to. This is a change of basis, not a new
// physical assumption: expand the fixed Z-basis coefficients against the
// two analyzers' own eigenbases via <outcomeL,outcomeR|psi> = sum_{i,j in Z}
// conj(outcomeL_i) conj(outcomeR_j) psi_ij, exactly the same inner-product
// bookkeeping the Stern-Gerlach sim's single-particle applyT already does,
// just carried out once per particle instead of once for the pair together.
function jointAmplitude(basisL, basisR, outcomeL, outcomeR, coeffs) {
  const stateL = outcomeL === 'up' ? upEigenstate(...basisL) : downEigenstate(...basisL);
  const stateR = outcomeR === 'up' ? upEigenstate(...basisR) : downEigenstate(...basisR);

  const term = (ci, cj, coeff) => cMul(cMul(cConj(ci), cConj(cj)), coeff);
  return cAdd(
    cAdd(term(stateL.a, stateR.a, coeffs.uu), term(stateL.a, stateR.b, coeffs.ud)),
    cAdd(term(stateL.b, stateR.a, coeffs.du), term(stateL.b, stateR.b, coeffs.dd))
  );
}

function jointProbabilitiesQuantum(basisL, basisR, coeffs) {
  const n = normalizedCoeffs(coeffs);
  return {
    uu: cAbs2(jointAmplitude(basisL, basisR, 'up', 'up', n)),
    ud: cAbs2(jointAmplitude(basisL, basisR, 'up', 'down', n)),
    du: cAbs2(jointAmplitude(basisL, basisR, 'down', 'up', n)),
    dd: cAbs2(jointAmplitude(basisL, basisR, 'down', 'down', n)),
  };
}

// The single-particle Born-rule probability of measuring `outcome` in
// `basis`, given the particle is *definitely* (not in superposition) in the
// up_Z or down_Z state -- reuses the same upEigenstate/downEigenstate
// change-of-basis as the quantum case above, just for one particle instead
// of the pair, since once the classical model's hidden state is fixed (see
// jointProbabilitiesClassical) each particle is an ordinary, unentangled
// single-qubit system.
function singleProb(basis, outcome, hiddenIsUp) {
  const target = outcome === 'up' ? upEigenstate(...basis) : downEigenstate(...basis);
  const hidden = hiddenIsUp ? { a: { re: 1, im: 0 }, b: { re: 0, im: 0 } } : { a: { re: 0, im: 0 }, b: { re: 1, im: 0 } };
  const amp = cAdd(cMul(cConj(target.a), hidden.a), cMul(cConj(target.b), hidden.b));
  return cAbs2(amp);
}

// Letter <-> arm, matching the u/d convention every joint-outcome key in
// this file already uses (first letter is L, second is R).
const ARM_LETTER = { up: 'u', down: 'd' };

// The "obvious" classical explanation for perfect correlation, without
// entanglement: the oven hands out a *definite* pair every time -- both
// particles' Z-spins fixed in advance, never a superposition -- decided by a
// weighted die roll over the four possible (hiddenL, hiddenR) pairings
// (`weights`, renormalized to sum to 1). Each particle's *measured* outcome
// then depends only on its own hidden value and its own analyzer's setting
// (via singleProb's ordinary single-particle Born rule), never on the other
// particle's hidden value or analyzer -- that locality is what makes this a
// genuine (as opposed to quantum) hidden-variable model, and is exactly what
// Bell's theorem shows can't reproduce quantum mechanics once the two
// analyzers' bases differ. The original, single-weight version of this
// model (uu/dd only, 50/50) is just weights = {uu:1, ud:0, du:0, dd:1}.
function jointProbabilitiesClassical(basisL, basisR, weights) {
  const total = weights.uu + weights.ud + weights.du + weights.dd;
  if (total === 0) return { uu: 0, ud: 0, du: 0, dd: 0 }; // degenerate all-zero input -- samplePairOutcome's own fallback covers this, same as normalizedCoeffs' analogous guard

  // pL[hiddenArm][measuredArm] -- probability analyzer L reports
  // `measuredArm` given the oven handed particle L the definite hidden value
  // `hiddenArm`; pR is the same for particle R.
  const pLupIfUp = singleProb(basisL, 'up', true);
  const pLupIfDown = singleProb(basisL, 'up', false);
  const pRupIfUp = singleProb(basisR, 'up', true);
  const pRupIfDown = singleProb(basisR, 'up', false);
  const pL = { up: { up: pLupIfUp, down: 1 - pLupIfUp }, down: { up: pLupIfDown, down: 1 - pLupIfDown } };
  const pR = { up: { up: pRupIfUp, down: 1 - pRupIfUp }, down: { up: pRupIfDown, down: 1 - pRupIfDown } };

  // Sum over all four (hiddenL, hiddenR) pairings, each contributing its own
  // (renormalized) weight times each particle's own independent measurement
  // probability -- the direct generalization of the old function's two-term
  // sums (over just "both up" / "both down") to all four hidden pairings.
  const result = { uu: 0, ud: 0, du: 0, dd: 0 };
  ['up', 'down'].forEach((hiddenL) => {
    ['up', 'down'].forEach((hiddenR) => {
      const hiddenWeight = weights[ARM_LETTER[hiddenL] + ARM_LETTER[hiddenR]] / total;
      ['up', 'down'].forEach((measuredL) => {
        ['up', 'down'].forEach((measuredR) => {
          const key = ARM_LETTER[measuredL] + ARM_LETTER[measuredR];
          result[key] += hiddenWeight * pL[hiddenL][measuredL] * pR[hiddenR][measuredR];
        });
      });
    });
  });
  return result;
}

// --- Hidden instruction sets -----------------------------------------------
// Bell's own original formulation of a local hidden variable: rather than a
// single fixed hidden Z-value (jointProbabilitiesClassical above), each
// particle secretly carries a full, predetermined answer for *every one* of
// a handful of analyzer directions the user has chosen -- an "instruction
// set" -- decided once per pair (or, if the two particles' sheets are
// independent, once per particle) by a weighted die roll over the user's own
// listed instruction sets. This is expressive enough to construct -- and
// then empirically watch fail -- the specific local-realist model Bell's
// theorem rules out, once three or four well-chosen directions are in play;
// the fixed single-hidden-value model above can't even attempt that, since
// it only ever has an opinion about the Z axis.
//
// A "column" is one user-chosen direction: { id, thetaDeg, phiDeg }, always
// whole degrees -- both this sim's own display precision for these, and what
// lets an analyzer's current [theta, phi] radians be matched back to "which
// column is this" exactly (findInstructionColumnIndex below) rather than
// comparing floats. A "row" is one full instruction set:
// { id, signs: { [columnId]: 'up'|'down' }, weight }, with `weight` relative
// (not pre-normalized) same as every other "up to normalization" source
// here. Both a column and a row carry their own opaque id rather than being
// addressed by array position, so deleting one column can't silently shift
// which entry of an existing row's `signs` every other column now refers to.
//
// `source.particle1` is always Left's own sheet. Right reads `particle1`'s
// same columns/rows too when `relationship` is 'identical' or 'opposite'
// (one shared sheet, read at whichever column each side is set to -- see
// jointProbabilitiesSharedSheet); only 'independent' gives Right its own
// separate sheet, `particle2`, with its own columns as well as its own rows
// -- the two sides can then be set to genuinely different menus of
// directions entirely, the asymmetric-settings structure a CHSH-style test
// needs.

// Rounds to the nearest whole degree and folds phi into [0, 360) -- matches
// how a column's own thetaDeg/phiDeg are always stored, so this comparison
// is exact for any analyzer setting a user could actually have dialed in
// (whether via this mode's own column-locked stepper, or the ordinary
// X/Y/Z/angle controls), not just floating-point-close.
function basisMatchesColumn(basis, column) {
  const thetaDeg = Math.round(basis[0] * (180 / Math.PI));
  const phiDeg = ((Math.round(basis[1] * (180 / Math.PI)) % 360) + 360) % 360;
  return thetaDeg === column.thetaDeg && phiDeg === ((column.phiDeg % 360) + 360) % 360;
}

// Which of `columns` (if any) an analyzer's current [theta, phi] basis
// matches -- -1 if it's set to a direction with no instructions. Exported
// so App.jsx's UI can reuse this exact same check, both to drive the
// column-locked stepper's own "which of 1..N am I on" display and to decide
// when to show the "no instructions for this direction" warning -- one
// implementation, so the two can never quietly disagree about what counts
// as valid.
export function findInstructionColumnIndex(basis, columns) {
  return columns.findIndex((column) => basisMatchesColumn(basis, column));
}

function flipSign(sign) { return sign === 'up' ? 'down' : 'up'; }

// One sheet's own weighted rows, reduced to the probability it reports each
// outcome when read at `columnId` -- used directly for the 'independent'
// relationship below, where the two sides' outcomes really are statistically
// independent of each other once each sheet is drawn, so reducing each sheet
// down to its own marginal first (rather than working with pairs of rows
// directly, as jointProbabilitiesSharedSheet has to) is both correct and
// simpler.
function sheetMarginal(rows, columnId) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (total === 0) return { up: 0, down: 0 };
  const upWeight = rows.reduce((sum, row) => sum + (row.signs[columnId] === 'up' ? row.weight : 0), 0);
  return { up: upWeight / total, down: (total - upWeight) / total };
}

// The 'identical'/'opposite' relationship: a single shared sheet (`rows`),
// one row of which is drawn (weighted) per pair and read at *both* sides'
// own chosen column -- Left always reads its own outcome straight;
// Opposite means Right reads the flip of what that same row says at its own
// column, Identical means Right reads it straight too. Keeping both sides'
// outcomes tied to one shared row draw (rather than reducing to marginals
// like sheetMarginal) is exactly what preserves the correlation between
// them -- the entire point of "identical" or "opposite" sheets.
function jointProbabilitiesSharedSheet(rows, colIdL, colIdR, flipRight) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const result = { uu: 0, ud: 0, du: 0, dd: 0 };
  if (total === 0) return result;
  rows.forEach((row) => {
    const outcomeL = row.signs[colIdL];
    const outcomeR = flipRight ? flipSign(row.signs[colIdR]) : row.signs[colIdR];
    const key = (outcomeL === 'up' ? 'u' : 'd') + (outcomeR === 'up' ? 'u' : 'd');
    result[key] += row.weight / total;
  });
  return result;
}

// The 'independent' relationship: two separately-drawn sheets, so the joint
// distribution is just the product of each side's own marginal -- no
// correlation between the two particles at all beyond whatever each sheet's
// own weights happen to encode on their own.
function jointProbabilitiesIndependentSheets(rowsL, colIdL, rowsR, colIdR) {
  const pL = sheetMarginal(rowsL, colIdL);
  const pR = sheetMarginal(rowsR, colIdR);
  return { uu: pL.up * pR.up, ud: pL.up * pR.down, du: pL.down * pR.up, dd: pL.down * pR.down };
}

function jointProbabilitiesInstructionSets(basisL, basisR, source) {
  const { relationship, particle1, particle2 } = source;
  const rightSheet = relationship === 'independent' ? particle2 : particle1;
  const colIndexL = findInstructionColumnIndex(basisL, particle1.columns);
  const colIndexR = findInstructionColumnIndex(basisR, rightSheet.columns);
  if (colIndexL === -1 || colIndexR === -1) {
    // Either analyzer is set to a direction with no instructions -- App.jsx
    // itself is what actually keeps a pair from ever being run in this
    // state (see findInstructionColumnIndex's own comment); this all-zero
    // fallback just keeps the theoretical-probability overlay, which
    // recomputes on every render regardless of whether Run is enabled, from
    // operating on a nonexistent column instead of throwing.
    return { uu: 0, ud: 0, du: 0, dd: 0 };
  }
  const colIdL = particle1.columns[colIndexL].id;
  const colIdR = rightSheet.columns[colIndexR].id;
  return relationship === 'independent'
    ? jointProbabilitiesIndependentSheets(particle1.rows, colIdL, rightSheet.rows, colIdR)
    : jointProbabilitiesSharedSheet(particle1.rows, colIdL, colIdR, relationship === 'opposite');
}

// The four joint outcome probabilities for one pair, given the two
// analyzers' current [theta, phi] bases and the oven's current source --
// sums to 1 (up to floating-point noise). This is the one place
// entanglement actually shows up: for a 'quantum' source, unlike two
// independently-random coins (or the 'classical' source above), these four
// numbers depend on the *angle between* basisL and basisR, not just on each
// analyzer's own setting.
export function jointProbabilities(basisL, basisR, source) {
  if (source.kind === 'classical') return jointProbabilitiesClassical(basisL, basisR, source.weights);
  if (source.kind === 'instructionSets') return jointProbabilitiesInstructionSets(basisL, basisR, source);
  return jointProbabilitiesQuantum(basisL, basisR, source.coeffs);
}

// Monte-Carlo draw of one pair's joint outcome, weighted by
// jointProbabilities -- the two arms are sampled together, from one shared
// random number, precisely because (for a 'quantum' source) they are not
// independent.
export function samplePairOutcome(basisL, basisR, source) {
  const probs = jointProbabilities(basisL, basisR, source);
  const r = Math.random();
  let acc = 0;
  for (const key of ['uu', 'ud', 'du', 'dd']) {
    acc += probs[key];
    if (r < acc) return { armL: key[0] === 'u' ? 'up' : 'down', armR: key[1] === 'u' ? 'up' : 'down' };
  }
  return { armL: 'down', armR: 'down' }; // floating-point fallback if the four probabilities summed to just under 1
}

// Exact theoretical hit probability for each of the four fixed detectors,
// in the same { sgIndex, arm, colorId, prob } shape the Stern-Gerlach sim's
// theoreticalProbabilities returns, so Histogram.jsx's theory-overlay code
// can stay unmodified. Computed as the true marginal (summing the joint
// distribution over the partner's outcome) rather than assumed -- every
// Bell state and the classical mixture both happen to always give exactly
// 1/2 on every detector regardless of either analyzer's orientation (a
// maximally-entangled pure state's reduced single-particle state is always
// maximally mixed, and the classical coin-flip mixture is symmetric by
// construction), but a general custom state need not be maximally entangled
// -- e.g. (a,b,c,d) = (1,0,0,0) is just the definite product state |up,up>,
// whose marginals are 1 and 0, not 1/2 and 1/2. Either way, this is the
// flip side of entanglement being real: the *correlation* lives entirely in
// the joint statistics (jointProbabilities above), and for a maximally-
// entangled or classically-mixed source is invisible in either detector's
// own marginal count on its own.
export function theoreticalProbabilities(experiment, source) {
  const probs = jointProbabilities(experiment[0].basis, experiment[1].basis, source);
  const marginal = {
    0: { up: probs.uu + probs.ud, down: probs.du + probs.dd },
    1: { up: probs.uu + probs.du, down: probs.ud + probs.dd },
  };
  const results = [];
  experiment.forEach((sg, sgIndex) => {
    ['up', 'down'].forEach((arm) => {
      if (sg[arm]?.type === 'pc') {
        results.push({ sgIndex, arm, colorId: sg[arm].colorId, prob: marginal[sgIndex][arm] });
      }
    });
  });
  return results;
}
