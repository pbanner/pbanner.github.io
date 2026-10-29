// Point charges' colors and limits, and the sidebar's two charge buttons.
// Plain data, no React.
//
// A placed point charge is { id, kind: 'point', position: [x, y, z], q },
// with q a whole number of units of some elementary charge "q", from
// -MAX_CHARGE to +MAX_CHARGE but never 0. The sidebar places +1 or -1; the properties
// panel changes it from there.
export const MAX_CHARGE = 5;

const POSITIVE_COLOR = '#d63a3a';
const NEGATIVE_COLOR = '#2f6fd6';

export function chargeColor(q) {
  return q > 0 ? POSITIVE_COLOR : NEGATIVE_COLOR;
}

// "+3", "−2" (a true minus sign), or just "+" / "−" for a unit charge.
export function chargeSignText(q) {
  const sign = q > 0 ? '+' : '−';
  return Math.abs(q) === 1 ? sign : `${sign}${Math.abs(q)}`;
}

// The sidebar's buttons, also used by the placement ghost.
export const CHARGE_TYPES = [
  { id: 'positive', label: 'Positive Charge', q: +1, color: POSITIVE_COLOR },
  { id: 'negative', label: 'Negative Charge', q: -1, color: NEGATIVE_COLOR },
];

export function getChargeType(id) {
  return CHARGE_TYPES.find((t) => t.id === id);
}
