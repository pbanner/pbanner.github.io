// The properties panel in the upper-right corner: the settings of whatever
// is selected, shown only while something is. Styled like the Display
// Options panel (.overlay-controls in App.css). Purely presentational: the
// selection and the charges live in App.jsx.
import { MAX_CHARGE } from './chargeTypes.js';

// The charge's value in units of q: "+3 q", "−1 q" (a true minus sign).
function ChargeValue({ q }) {
  return (
    <span className="stepper-value">
      {q > 0 ? '+' : '−'}{Math.abs(q)} <i>q</i>
    </span>
  );
}

// The next charge up or down from q, skipping 0: a charge of 0 would be no
// charge at all, so stepping down from +1 goes straight to −1.
function stepCharge(q, delta) {
  const next = q + delta;
  return next === 0 ? next + delta : next;
}

// charge: the selected { id, position, q }.
// onChangeCharge(q) / onDelete() / onClose(): edits, and deselecting.
export default function PropertiesPanel({ charge, onChangeCharge, onDelete, onClose }) {
  return (
    <div className="overlay-controls properties-panel">
      <div className="panel-header">
        <h3>Point Charge</h3>
        <button type="button" className="panel-close-button" aria-label="Deselect" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="property-row">
        <span>Charge</span>
        <div className="stepper">
          <button type="button" aria-label="Decrease charge" disabled={charge.q <= -MAX_CHARGE} onClick={() => onChangeCharge(stepCharge(charge.q, -1))}>
            −
          </button>
          <ChargeValue q={charge.q} />
          <button type="button" aria-label="Increase charge" disabled={charge.q >= MAX_CHARGE} onClick={() => onChangeCharge(stepCharge(charge.q, +1))}>
            +
          </button>
        </div>
      </div>
      <button type="button" className="control-button panel-delete-button" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
