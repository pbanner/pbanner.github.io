// Shared axis-stepper constants -- kept out of controls.jsx (like
// colors.js is kept out of the components that use it) so that file can
// export *only* components, which is what lets Vite's Fast Refresh
// hot-swap them without a full page reload.

export const SG_OPTION_LABELS = ['X', 'Y', 'Z'];
export const SG_OPTION_BASES = [[Math.PI / 2, 0], [Math.PI / 2, Math.PI / 2], [0, 0]];
// The advanced θ/ϕ controls are degrees-in, degrees-out for the user -- the
// underlying [theta, phi] value itself always stays in radians, since
// that's what every physics function expects.
export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
// Rounds for *display only* -- the underlying radians value is never
// touched, so this just hides floating-point noise like
// 59.999999999999996 in the textbox without losing any real precision.
export const roundDeg = (d) => Math.round(d * 1000) / 1000;