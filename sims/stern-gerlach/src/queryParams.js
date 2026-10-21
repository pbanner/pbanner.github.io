// PhET-style URL query parameters -- an instructor can append e.g.
// "?phi=off" to this sim's own URL to simplify what students see, with no
// in-app control needed to reach that state (and none offered to leave it,
// short of editing the URL back). Read once, at module load, into plain
// constants rather than React state: nothing in a running session ever
// changes them, since there's no UI that could. Combine several with "&",
// e.g. "?phi=off&normalize=detected".
const params = new URLSearchParams(window.location.search);

// Confines every analyzer (and every field) to the X-Z plane by treating phi
// as always 0: hides the axis stepper's advanced phi box, removes Y from the
// X/Y/Z quick-stepper (axisOptions.js's SG_OPTION_LABELS/SG_OPTION_BASES --
// Y needs phi=90, which is no longer reachable), and collapses the lab
// canvas's off-axis SG label from a two-line theta/phi readout down to a
// single theta-only line (LabPanel.jsx's getSGLabel). Same parameter, same
// behavior, as the entanglement sim's own ?phi=off.
export const PHI_LOCKED = params.get('phi') === 'off';

// What every displayed percentage (histogram bar labels, the Shift+P
// theory cards, and the histogram's theory reference lines along with
// them) is a percentage *of*. By default that's every particle that came
// out of the oven -- including ones a beam block absorbed -- so a detector
// behind a beam-blocked arm reads as e.g. 25%, not 50%. "?normalize=detected"
// restores the older behavior of normalizing to just the particles that
// actually landed in some particle counter, so the percentages across all
// placed counters always sum to 100%.
export const NORMALIZE_TO_DETECTED = params.get('normalize') === 'detected';
