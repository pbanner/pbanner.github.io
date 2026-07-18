// Shared spin-1/2 physics -- lives in its own module (like colors.js) so
// LabPanel's Monte-Carlo particle simulation and Histogram's exact
// theoretical-probability overlay compute against the exact same tested
// math, rather than maintaining two independently implemented models of
// the same quantum mechanics.

// Complex arithmetic on plain { re, im } objects -- no library needed for
// just add/multiply/scale/modulus/conjugate.
export function cAdd(z1, z2) { return { re: z1.re + z2.re, im: z1.im + z2.im }; }
export function cMul(z1, z2) { return { re: z1.re * z2.re - z1.im * z2.im, im: z1.re * z2.im + z1.im * z2.re }; }
export function cScale(z, s) { return { re: z.re * s, im: z.im * s }; }
export function cExp(theta) { return { re: Math.cos(theta), im: Math.sin(theta) }; } // e^{i*theta}
export function cAbs2(z) { return z.re * z.re + z.im * z.im; }
export function cConj(z) { return { re: z.re, im: -z.im }; }

// <u|v> for two 2-component states
export function innerProduct(u, v) {
  return cAdd(cMul(cConj(u.a), v.a), cMul(cConj(u.b), v.b));
}

export function upEigenstate(theta, phi) {
  return { a: { re: Math.cos(theta / 2), im: 0 }, b: cScale(cExp(phi), Math.sin(theta / 2)) };
}
export function downEigenstate(theta, phi) {
  return { a: cScale(cExp(-phi), -Math.sin(theta / 2)), b: { re: Math.cos(theta / 2), im: 0 } };
}

// Measurement amplitudes for basis [theta, phi]: the projection of `state`
// onto T's (= n_hat . sigma's) +1/-1 eigenvectors, i.e. <+n_hat|state> and
// <-n_hat|state> -- NOT T applied to state. T*v is a different, generally
// non-diagonal operation; it only coincides with the eigen-decomposition
// when T is already diagonal in the Z basis, which is true for Z itself
// but false for X/Y -- using T*v directly gave correct single-SG stats
// (fooled by the marginal) but wrong conditional probabilities the moment
// a second SG measured along a different axis than the first.
export function applyT(theta, phi, state) {
  const up = innerProduct(upEigenstate(theta, phi), state);
  const down = innerProduct(downEigenstate(theta, phi), state);
  return { up, down };
}

// Maximally-mixed oven state (rho = I/2), unraveled as one uniformly
// random pure state per particle -- averaged over many particles this
// reproduces I/2's measurement statistics exactly (50/50 along any axis),
// without needing to propagate a density matrix through the whole chain.
export function sampleOvenState() {
  const phi = Math.random() * 2 * Math.PI;
  const theta = Math.acos(2 * Math.random() - 1); // uniform on the sphere, not uniform in theta
  return upEigenstate(theta, phi);
}

// Exact theoretical hit probability for every placed particle counter,
// mirroring samplePath's branching structure exactly (same experiment
// data, same measurement/transparency rules) but replacing each random
// Born-rule draw with both weighted branches, walked recursively.
//
// The key fact that makes this tractable in closed form: a projective
// measurement of a maximally-mixed qubit (the oven state) is 50/50 along
// *any* basis, and -- regardless of which random pure state unraveled it
// -- the post-measurement state conditioned on the outcome is always
// exactly that basis's eigenstate, same as it would be for any other
// starting state. So the very first real measurement any given path
// hits is always an exact coin flip with no dependence on basis, and
// every measurement after that is ordinary sequential Born-rule
// projection off a known, definite prior eigenstate -- no density
// matrices or numerical integration needed.
//
// Returns one entry per reachable particle counter: { sgIndex, arm,
// colorId, prob }. Probabilities of paths that end at a beam block or
// run off the end of the chain unmeasured are simply not represented --
// a placed PC that's unreachable (probability exactly 0) is likewise
// just absent, so callers should treat a missing entry as probability 0.
export function theoreticalProbabilities(experiment) {
  const results = [];

  // priorState === null means "no real measurement has happened yet on
  // this path" -- i.e. the state is still the random, unmeasured oven
  // state, which is what makes the very next real measurement a 50/50
  // regardless of its basis.
  function recurse(sgIndex, priorState, pathProb) {
    if (pathProb <= 0 || sgIndex >= experiment.length) return;
    const sg = experiment[sgIndex];
    const [theta, phi] = sg.basis;

    if (sg.up === null && sg.down === null) {
      recurse(sgIndex + 1, priorState, pathProb); // transparent -- no collapse, no branching
      return;
    }

    const armProb = priorState === null
      ? { up: 0.5, down: 0.5 }
      : (() => {
          const { up, down } = applyT(theta, phi, priorState);
          return { up: cAbs2(up), down: cAbs2(down) };
        })();

    ['up', 'down'].forEach((arm) => {
      const branchProb = pathProb * armProb[arm];
      const dest = sg[arm];
      if (dest === null) {
        const collapsed = arm === 'up' ? upEigenstate(theta, phi) : downEigenstate(theta, phi);
        recurse(sgIndex + 1, collapsed, branchProb);
      } else if (dest.type === 'pc') {
        results.push({ sgIndex, arm, colorId: dest.colorId, prob: branchProb });
      }
      // dest === 'bb': absorbed there, no detector credit
    });
  }

  recurse(0, null, 1);
  return results;
}
