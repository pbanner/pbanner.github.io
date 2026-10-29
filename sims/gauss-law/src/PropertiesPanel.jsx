// The properties panel in the upper-right corner: the settings of whatever
// is selected, shown only while something is. Styled like the Display
// Options panel (.overlay-controls in App.css). Purely presentational: the
// selection and the charges live in App.jsx.
//
// Every length is shown and typed in ticks, like the coordinate readout
// (positions in state are in world units; 1 tick = SNAP_STEP).
import { useState } from 'react';
import { CHARGE_SETTINGS, MAX_CHARGE_STEPS, chargeSteps, withChargeSteps } from './chargeTypes.js';
import { SNAP_STEP } from './geometry.js';
import { WORLD_HALF_EXTENT } from './sceneConstants.js';

const TITLES = { point: 'Point Charge', sphere: 'Charged Sphere', rod: 'Charged Rod', plane: 'Charged Plane' };
const FORMS = {
  sphere: [['shell', 'Shell'], ['solid', 'Solid']],
  rod: [['line', 'Line'], ['shell', 'Shell'], ['solid', 'Solid']],
  plane: [['sheet', 'Sheet'], ['slab', 'Slab']],
};
const AXIS_NAMES = ['x', 'y', 'z'];
// A plane is named by the coordinate plane it's parallel to, i.e. by the
// two axes other than its own.
const PLANE_NAMES = ['yz', 'xz', 'xy'];

const WORLD_LIMIT_TICKS = WORLD_HALF_EXTENT / SNAP_STEP; // the box's edges, +/-10
const SIZE_LIMITS_TICKS = { min: 0.5, max: WORLD_LIMIT_TICKS }; // radii, thicknesses

const toTicks = (world) => world / SNAP_STEP;
const toWorld = (ticks) => ticks * SNAP_STEP;

// A number of ticks as text: whole numbers plainly, others to 2 decimals
// (trailing zeros dropped), with a true minus sign.
function formatTicks(ticks) {
  const rounded = Math.round(ticks * 100) / 100;
  return String(rounded).replace(/^-/, '−');
}

// A number box. While it's being typed in, it shows the draft text; Enter
// or leaving the box commits it (clamped to [min, max]), and text that
// isn't a number puts the old value back.
function NumberField({ label, ticks, min, max, onCommit }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft === null) return;
    const value = Number.parseFloat(draft.replace('−', '-'));
    setDraft(null);
    if (Number.isFinite(value)) onCommit(Math.min(max, Math.max(min, value)));
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? formatTicks(ticks)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

// A choice among a few options, as a row of joined toggle buttons.
function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button type="button" key={v} className={v === value ? 'active' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// The charge (or charge density) setting's value: "+3 q", "−0.10 q/tick",
// "+0.010 q/tick²". The q is italic, as the symbol for the unit charge.
function ChargeValue({ charge }) {
  const { key, step, unit } = CHARGE_SETTINGS[charge.kind];
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const value = charge[key];
  return (
    <span className="stepper-value">
      {value > 0 ? '+' : '−'}{Math.abs(value).toFixed(decimals)} <i>q</i>{unit.slice(1)}
    </span>
  );
}

// The next step up or down, skipping 0: no charge at all isn't an
// option, so stepping down from +1 goes straight to −1.
function nextSteps(steps, delta) {
  const next = steps + delta;
  return next === 0 ? next + delta : next;
}

// charge: the selected charge (see chargeTypes.js).
// onChange(changes): new values for some of its fields.
// onDelete() / onClose(): delete it, or deselect.
export default function PropertiesPanel({ charge, onChange, onDelete, onClose }) {
  const { kind } = charge;
  const steps = chargeSteps(charge);
  // A rod's or plane's charge is a density: lambda, charge per length, or
  // sigma, charge per area, the symbols Gauss's law problems use.
  const label = kind === 'rod' ? 'Density λ' : kind === 'plane' ? 'Density σ' : 'Charge';

  // Which coordinates of its position can be set: all three for a point or
  // sphere, the two across a rod, the one along a plane's axis.
  let coords = [0, 1, 2];
  if (kind === 'rod') coords = coords.filter((k) => k !== charge.axis);
  if (kind === 'plane') coords = [charge.axis];
  const setCoord = (k, ticks) => {
    const position = [...charge.position];
    position[k] = toWorld(ticks);
    onChange({ position });
  };
  // Turning a plane keeps its distance from the origin: x = 2 becomes
  // y = 2, say. (A rod keeps going through the same point.)
  const setPlaneAxis = (axis) => {
    const position = [0, 0, 0];
    position[axis] = charge.position[charge.axis];
    onChange({ axis, position });
  };

  return (
    <div className="overlay-controls properties-panel">
      <div className="panel-header">
        <h3>{TITLES[kind]}</h3>
        <button type="button" className="panel-close-button" aria-label="Deselect" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="property-row">
        <span>{label}</span>
        <div className="stepper">
          <button type="button" aria-label="Decrease charge" disabled={steps <= -MAX_CHARGE_STEPS} onClick={() => onChange(withChargeSteps(charge, nextSteps(steps, -1)))}>
            −
          </button>
          <ChargeValue charge={charge} />
          <button type="button" aria-label="Increase charge" disabled={steps >= MAX_CHARGE_STEPS} onClick={() => onChange(withChargeSteps(charge, nextSteps(steps, +1)))}>
            +
          </button>
        </div>
      </div>

      {FORMS[kind] && (
        <div className="property-row">
          <span>Form</span>
          <Segmented options={FORMS[kind]} value={charge.form} onChange={(form) => onChange({ form })} />
        </div>
      )}

      {kind === 'rod' && (
        <div className="property-row">
          <span>Along</span>
          <Segmented options={AXIS_NAMES.map((n, k) => [k, n])} value={charge.axis} onChange={(axis) => onChange({ axis })} />
        </div>
      )}
      {kind === 'plane' && (
        <div className="property-row">
          <span>Parallel to</span>
          <Segmented options={PLANE_NAMES.map((n, k) => [k, n])} value={charge.axis} onChange={setPlaneAxis} />
        </div>
      )}

      <div className="property-row">
        <span>{kind === 'rod' ? 'Through' : kind === 'plane' ? 'At' : kind === 'sphere' ? 'Center' : 'Position'}</span>
        <div className="number-fields">
          {coords.map((k) => (
            <NumberField
              key={`${k}-${charge.id}`}
              label={AXIS_NAMES[k]}
              ticks={toTicks(charge.position[k])}
              min={-WORLD_LIMIT_TICKS}
              max={WORLD_LIMIT_TICKS}
              onCommit={(ticks) => setCoord(k, ticks)}
            />
          ))}
        </div>
      </div>

      {(kind === 'sphere' || (kind === 'rod' && charge.form !== 'line')) && (
        <div className="property-row">
          <span>Radius</span>
          <div className="number-fields">
            <NumberField key={`radius-${charge.id}`} label="" ticks={toTicks(charge.radius)} {...SIZE_LIMITS_TICKS} onCommit={(ticks) => onChange({ radius: toWorld(ticks) })} />
          </div>
        </div>
      )}
      {kind === 'plane' && charge.form === 'slab' && (
        <div className="property-row">
          <span>Thickness</span>
          <div className="number-fields">
            <NumberField key={`thickness-${charge.id}`} label="" ticks={toTicks(charge.thickness)} {...SIZE_LIMITS_TICKS} onCommit={(ticks) => onChange({ thickness: toWorld(ticks) })} />
          </div>
        </div>
      )}

      <button type="button" className="control-button panel-delete-button" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
