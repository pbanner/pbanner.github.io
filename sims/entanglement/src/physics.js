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

// --- Entangled pair -----------------------------------------------------
// The oven emits both particles of a pair in the spin singlet state
//   |psi> = (|up_Z>_L |down_Z>_R - |down_Z>_L |up_Z>_R) / sqrt(2),
// written here as four complex coefficients on the Z-basis product states
// {L,R} in {up,down}^2 -- uu (both up), ud (L up, R down), du, dd. This is
// the state that gives perfect anti-correlation when both analyzers share
// the same orientation, and (unlike a merely classically-correlated coin
// flip) stays correlated in a way no local hidden-variable model can
// reproduce once the two orientations differ -- the whole point of an
// entanglement demo. It is also rotationally invariant: measuring both
// particles along *any* common axis reproduces the same perfect
// anti-correlation, not just along Z.
const SINGLET_COEFFS = {
  uu: { re: 0, im: 0 },
  ud: { re: 1 / Math.SQRT2, im: 0 },
  du: { re: -1 / Math.SQRT2, im: 0 },
  dd: { re: 0, im: 0 },
};

// <outcomeL, outcomeR | psi> for the joint state above, where outcomeL and
// outcomeR are each the analyzer's own +n_hat/-n_hat eigenstate (from
// upEigenstate/downEigenstate) for whatever basis that analyzer is set to.
// This is a change of basis, not a new physical assumption: expand the
// fixed Z-basis singlet coefficients against the two analyzers' own
// eigenbases via <outcomeL,outcomeR|psi> = sum_{i,j in Z} conj(outcomeL_i)
// conj(outcomeR_j) psi_ij, exactly the same inner-product bookkeeping
// physics.js's single-particle applyT already does, just carried out once
// per particle instead of once for the pair together.
function jointAmplitude(basisL, basisR, outcomeL, outcomeR) {
  const stateL = outcomeL === 'up' ? upEigenstate(...basisL) : downEigenstate(...basisL);
  const stateR = outcomeR === 'up' ? upEigenstate(...basisR) : downEigenstate(...basisR);

  const term = (ci, cj, coeff) => cMul(cMul(cConj(ci), cConj(cj)), coeff);
  return cAdd(
    cAdd(term(stateL.a, stateR.a, SINGLET_COEFFS.uu), term(stateL.a, stateR.b, SINGLET_COEFFS.ud)),
    cAdd(term(stateL.b, stateR.a, SINGLET_COEFFS.du), term(stateL.b, stateR.b, SINGLET_COEFFS.dd))
  );
}

// The four joint outcome probabilities for one pair, given the two
// analyzers' current [theta, phi] bases -- sums to 1 (up to floating-point
// noise). This is the one place the entanglement actually shows up: unlike
// two independently-random coins, these four numbers depend on the *angle
// between* basisL and basisR, not just on each analyzer's own setting.
export function jointProbabilities(basisL, basisR) {
  return {
    uu: cAbs2(jointAmplitude(basisL, basisR, 'up', 'up')),
    ud: cAbs2(jointAmplitude(basisL, basisR, 'up', 'down')),
    du: cAbs2(jointAmplitude(basisL, basisR, 'down', 'up')),
    dd: cAbs2(jointAmplitude(basisL, basisR, 'down', 'down')),
  };
}

// Monte-Carlo draw of one pair's joint outcome, weighted by
// jointProbabilities -- the two arms are sampled together, from one shared
// random number, precisely because they are *not* independent.
export function samplePairOutcome(basisL, basisR) {
  const probs = jointProbabilities(basisL, basisR);
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
// can stay unmodified. For an entangled pair this is *always* exactly 1/2,
// on every detector, regardless of either analyzer's orientation: the
// reduced state of either particle alone (ignoring its partner) is the
// maximally-mixed state, a direct consequence of the singlet being a pure,
// maximally-entangled state. This is the flip side of entanglement being
// real -- the correlation lives entirely in the *joint* statistics
// (jointProbabilities above), and is invisible in either detector's own
// marginal count on its own.
export function theoreticalProbabilities(experiment) {
  const results = [];
  experiment.forEach((sg, sgIndex) => {
    ['up', 'down'].forEach((arm) => {
      if (sg[arm]?.type === 'pc') {
        results.push({ sgIndex, arm, colorId: sg[arm].colorId, prob: 0.5 });
      }
    });
  });
  return results;
}
