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
//   { kind: 'classical' }                       -- see jointProbabilitiesClassical
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

// The "obvious" classical explanation for perfect correlation, without
// entanglement: the oven hands out a *definite* pair every time, decided by
// an ordinary coin flip -- both particles up_Z, or both down_Z, never a
// superposition of the two. This reproduces perfect (anti-)correlation
// whenever both analyzers share a basis, same as the quantum states -- but
// because it's a genuine local hidden-variable model (each particle's
// outcome depends only on its own analyzer and the shared coin flip, never
// on the other analyzer's setting), it disagrees with quantum mechanics once
// the two bases differ. That gap is the whole pedagogical point of offering
// this option: it's the "obvious" classical guess Bell's theorem rules out.
function jointProbabilitiesClassical(basisL, basisR) {
  const pLupIfUp = singleProb(basisL, 'up', true);
  const pLupIfDown = singleProb(basisL, 'up', false);
  const pRupIfUp = singleProb(basisR, 'up', true);
  const pRupIfDown = singleProb(basisR, 'up', false);
  return {
    uu: 0.5 * pLupIfUp * pRupIfUp + 0.5 * pLupIfDown * pRupIfDown,
    ud: 0.5 * pLupIfUp * (1 - pRupIfUp) + 0.5 * pLupIfDown * (1 - pRupIfDown),
    du: 0.5 * (1 - pLupIfUp) * pRupIfUp + 0.5 * (1 - pLupIfDown) * pRupIfDown,
    dd: 0.5 * (1 - pLupIfUp) * (1 - pRupIfUp) + 0.5 * (1 - pLupIfDown) * (1 - pRupIfDown),
  };
}

// The four joint outcome probabilities for one pair, given the two
// analyzers' current [theta, phi] bases and the oven's current source --
// sums to 1 (up to floating-point noise). This is the one place
// entanglement actually shows up: for a 'quantum' source, unlike two
// independently-random coins (or the 'classical' source above), these four
// numbers depend on the *angle between* basisL and basisR, not just on each
// analyzer's own setting.
export function jointProbabilities(basisL, basisR, source) {
  return source.kind === 'classical'
    ? jointProbabilitiesClassical(basisL, basisR)
    : jointProbabilitiesQuantum(basisL, basisR, source.coeffs);
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
