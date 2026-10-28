// Central list of placeable charges -- shared between the sidebar (icon
// buttons), the 2D placement ghost (App.jsx), and the 3D scene (which
// renders placed charges and the 3D placement ghost). Plain data, no React.
//
// q is in units of some elementary charge "q" for now; nothing computes a
// field from it yet.
export const CHARGE_TYPES = [
  { id: 'positive', label: 'Positive Charge', q: +1, sign: '+', color: '#d63a3a' },
  { id: 'negative', label: 'Negative Charge', q: -1, sign: '−', color: '#2f6fd6' },
];

export function getChargeType(id) {
  return CHARGE_TYPES.find((t) => t.id === id);
}

// Shown under the cursor while a charge is armed for placement.
export const PLACEMENT_MESSAGE = 'Click or release to place.\nPress Shift to raise or lower.\nEsc to cancel.';
