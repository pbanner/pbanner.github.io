// Shared axis-stepper constants -- kept out of controls.jsx (like
// colors.js is kept out of the components that use it) so that file can
// export *only* components, which is what lets Vite's Fast Refresh
// hot-swap them without a full page reload.

import { PHI_LOCKED } from './queryParams';

// Y sits at phi=90, which is unreachable once phi is locked to 0 (see
// queryParams.js) -- omitting it here, rather than filtering it out in
// every place that steps through or displays these, is what keeps both the
// AnalyzerStepper (App.jsx) and AxisStepper (controls.jsx) quick-steppers
// from ever landing on it, automatically: both already just cycle through
// whatever's in these two arrays.
export const SG_OPTION_LABELS = PHI_LOCKED ? ['X', 'Z'] : ['X', 'Y', 'Z'];
export const SG_OPTION_BASES = PHI_LOCKED ? [[Math.PI / 2, 0], [0, 0]] : [[Math.PI / 2, 0], [Math.PI / 2, Math.PI / 2], [0, 0]];
// The advanced θ/ϕ controls are degrees-in, degrees-out for the user -- the
// underlying [theta, phi] value itself always stays in radians, since
// that's what every physics function expects.
export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
// Rounds for *display only* -- the underlying radians value is never
// touched, so this just hides floating-point noise like
// 59.999999999999996 in the textbox without losing any real precision.
export const roundDeg = (d) => Math.round(d * 1000) / 1000;