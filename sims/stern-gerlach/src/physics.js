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

// Rotates a spin-1/2 state through `cycles` complete precessions about a
// field pointing along (axisTheta, axisPhi) -- the standard SU(2) rotation
// operator exp(-i*angle/2*(n_hat.sigma)), with angle = cycles * 2*PI. Note
// that's a spinor phase of 2*PI per cycle, not 4*PI: cycles=1 is exactly
// the point where a *classical* magnetic moment has turned once around the
// field and a spinor's sign has flipped (physically unobservable on its
// own), and cycles=2 is where the spinor itself returns to identical --
// not just projectively equivalent -- state, matching spin-1/2's familiar
// 4*PI periodicity.
export function precessState(state, axisTheta, axisPhi, cycles) {
  const angle = cycles * 2 * Math.PI;
  const nx = Math.sin(axisTheta) * Math.cos(axisPhi);
  const ny = Math.sin(axisTheta) * Math.sin(axisPhi);
  const nz = Math.cos(axisTheta);
  const c = Math.cos(angle / 2);
  const s = Math.sin(angle / 2);

  // U = cos(angle/2) I - i sin(angle/2) (n_hat . sigma), expanded into its
  // four complex entries.
  const u00 = { re: c, im: -nz * s };
  const u01 = { re: -ny * s, im: -nx * s };
  const u10 = { re: ny * s, im: -nx * s };
  const u11 = { re: c, im: nz * s };

  return {
    a: cAdd(cMul(u00, state.a), cMul(u01, state.b)),
    b: cAdd(cMul(u10, state.a), cMul(u11, state.b)),
  };
}

// Applies whatever field sits on one arm of one SG (or does nothing, if
// `field` is null) -- the single place that knows a null field is a no-op,
// shared by both samplePath's Monte-Carlo walk and theoreticalProbabilities'
// exact one below, so the two can't drift apart on this the way the file
// header comment already promises for the rest of the physics.
export function applyField(field, state) {
  return field ? precessState(state, field.axis[0], field.axis[1], field.magnitude) : state;
}

// Scales a 2-component state by a complex number.
function scaleState(state, z) {
  return { a: cMul(z, state.a), b: cMul(z, state.b) };
}

// Componentwise sum of two states -- not itself normalized; callers that
// need a valid state back, not just an intermediate, should follow with
// normalizeState.
function addStates(s1, s2) {
  return { a: cAdd(s1.a, s2.a), b: cAdd(s1.b, s2.b) };
}

function normalizeState(state) {
  const norm = Math.sqrt(cAbs2(state.a) + cAbs2(state.b));
  return { a: cScale(state.a, 1 / norm), b: cScale(state.b, 1 / norm) };
}

// A transparent SG (no detector on either arm) ordinarily just passes
// `state` through unchanged -- no measurement, no collapse, so the two
// arms recombine into exactly what went in. But that's only true if the
// two arms are physically identical; a field on one of them breaks that
// symmetry even though nothing here performs a real measurement. This
// decomposes `state` into the SG's own +/-n eigenbasis, applies whichever
// field sits on each arm (applyField is a no-op with none), and adds the
// two branches back into a single coherent state -- literally the same
// physics as a beam splitter followed by a perfect recombiner, which is
// what "transparent" has meant all along.
//
// The recombined state is renormalized before being returned. Without any
// field this is exact and a no-op (the two branches already summed to a
// unit vector). With one, the small renormalization stands in for the
// (unmodeled) chance that the field also nudges the particle's trajectory
// enough to miss recombination -- a real but second-order effect outside
// what a spin-only simulator can track. Treating recombination as always
// succeeding is the standard idealization for this kind of interference
// demo (this is the "spin echo" / Ramsey-style physics the field feature
// exists for).
export function recombineThroughFields(theta, phi, upField, downField, state) {
  if (!upField && !downField) return state; // nothing to do -- skip the wasted arithmetic on the common case

  const upAmp = innerProduct(upEigenstate(theta, phi), state);
  const downAmp = innerProduct(downEigenstate(theta, phi), state);

  const upBranch = scaleState(applyField(upField, upEigenstate(theta, phi)), upAmp);
  const downBranch = scaleState(applyField(downField, downEigenstate(theta, phi)), downAmp);

  return normalizeState(addStates(upBranch, downBranch));
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
      // A field on one of this SG's arms still coherently recombines --
      // recombineThroughFields is a no-op when neither arm has one, so this
      // is exactly the old "pass straight through" behavior in the common
      // case. priorState === null (no real measurement anywhere yet, so
      // this path is still the maximally-mixed oven state) is left as-is
      // even when a field is present: propagating a field through a still-
      // mixed state exactly would need a density-matrix treatment this
      // closed-form calculation doesn't do -- samplePath's Monte-Carlo walk
      // below has no such gap, since it always tracks one concrete sampled
      // state rather than a "still mixed" placeholder.
      const nextState = priorState === null ? null : recombineThroughFields(theta, phi, sg.field.up, sg.field.down, priorState);
      recurse(sgIndex + 1, nextState, pathProb); // transparent -- no branching
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
        recurse(sgIndex + 1, applyField(sg.field[arm], collapsed), branchProb);
      } else if (dest.type === 'pc') {
        results.push({ sgIndex, arm, colorId: dest.colorId, prob: branchProb });
      }
      // dest === 'bb': absorbed there, no detector credit
    });
  }

  recurse(0, null, 1);
  return results;
}