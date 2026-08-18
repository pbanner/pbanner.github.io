// Shared polarization physics -- lives in its own module (like the Stern-
// Gerlach sim's own physics.js) so LabPanel's Monte-Carlo photon simulation
// has one tested place to compute Jones-calculus wave-plate and polarizing-
// beamsplitter physics, rather than burying complex arithmetic inline in the
// animation code. Not shared with the Stern-Gerlach sim itself -- each sim
// is its own independent build, and the physics here (photon polarization)
// is unrelated to that one's (spin-1/2).

// Complex arithmetic on plain { re, im } objects -- the same minimal set
// the Stern-Gerlach sim's physics.js defines for itself.
export function cAdd(z1, z2) { return { re: z1.re + z2.re, im: z1.im + z2.im }; }
export function cMul(z1, z2) { return { re: z1.re * z2.re - z1.im * z2.im, im: z1.re * z2.im + z1.im * z2.re }; }
export function cAbs2(z) { return z.re * z.re + z.im * z.im; }

// A photon's polarization state: complex amplitudes in the fixed lab-frame
// horizontal/vertical basis (screen x/y) -- "H" and "V" name the two screen
// axes, not anything relative to whichever of the four cardinal directions
// the photon itself happens to be traveling in. That's the standard
// simplification for a top-down 2D polarization-optics demo like this one,
// and it's what lets a wave plate's fast-axis angle (comp.angle) and a PBS's
// transmit/reflect rule both be expressed in one fixed basis regardless of
// how the beam has already turned by the time it gets there.
export const H_STATE = { h: { re: 1, im: 0 }, v: { re: 0, im: 0 } };
export const V_STATE = { h: { re: 0, im: 0 }, v: { re: 1, im: 0 } };

// Applies a 2x2 complex Jones matrix, given as [[m00, m01], [m10, m11]], to
// a state -- the one place both wave-plate matrices below get used.
export function applyJones(matrix, state) {
  return {
    h: cAdd(cMul(matrix[0][0], state.h), cMul(matrix[0][1], state.v)),
    v: cAdd(cMul(matrix[1][0], state.h), cMul(matrix[1][1], state.v)),
  };
}

// Half-wave plate, fast axis at angleDeg from horizontal (same convention as
// WaveplateAngleControl's own ruler): the standard real Jones matrix
// [[cos2t, sin2t], [sin2t, -cos2t]] -- a reflection of the incoming
// polarization about the fast axis.
export function hwpMatrix(angleDeg) {
  const t = (angleDeg * Math.PI) / 180;
  const c2 = Math.cos(2 * t);
  const s2 = Math.sin(2 * t);
  return [
    [{ re: c2, im: 0 }, { re: s2, im: 0 }],
    [{ re: s2, im: 0 }, { re: -c2, im: 0 }],
  ];
}

// Quarter-wave plate, fast axis at angleDeg from horizontal: the standard
// form e^{i*pi/4} * [[cos^2 t + i*sin^2 t, (1-i)*sin t*cos t], [(1-i)*sin
// t*cos t, sin^2 t + i*cos^2 t]] -- a quarter-wave (90 deg) relative phase
// retardation between the fast and slow axes. The overall e^{i*pi/4} phase
// has no effect on any single photon's own measurement odds, but is kept
// for a mathematically complete (unitary) matrix.
export function qwpMatrix(angleDeg) {
  const t = (angleDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const c2 = c * c;
  const s2 = s * s;
  const cs = c * s;
  const phase = { re: Math.SQRT1_2, im: Math.SQRT1_2 }; // e^{i*pi/4}
  const off = cMul(phase, { re: cs, im: -cs }); // phase * (1 - i) * cs
  return [
    [cMul(phase, { re: c2, im: s2 }), off],
    [off, cMul(phase, { re: s2, im: c2 })],
  ];
}
