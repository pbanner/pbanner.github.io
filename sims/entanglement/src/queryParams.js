// PhET-style URL query parameters -- an instructor can append e.g.
// "?phi=off" to this sim's own URL to simplify what students see, with no
// in-app control needed to reach that state (and none offered to leave it,
// short of editing the URL back). Read once, at module load, into a plain
// constant rather than React state: nothing in a running session ever
// changes it, since there's no UI that could.
const params = new URLSearchParams(window.location.search);

// Confines every analyzer to the X-Z plane by treating phi as always 0:
// hides every phi control (the axis stepper's advanced theta/phi boxes,
// the direction list's own editor and stepper readout), removes Y from the
// X/Y/Z quick-stepper (axisOptions.js's SG_OPTION_LABELS/SG_OPTION_BASES --
// Y needs phi=90, which is no longer reachable), and collapses the lab
// canvas's off-axis SG label from a two-line theta/phi readout down to a
// single theta-only line (LabPanel.jsx's getSGLabel). This is a real
// physical restriction, not just a display one: with phi locked to 0, Y
// and -X (which need phi=90 and phi=180 respectively) can never be dialed
// in at all, on top of never being shown.
export const PHI_LOCKED = params.get('phi') === 'off';
