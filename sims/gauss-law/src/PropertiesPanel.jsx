// The properties panel in the upper-right corner: the settings of whatever
// is selected -- a charge (PropertiesPanel), the 2D cut (CutPanel) or a
// field probe (ProbePanel) -- shown only while something is. Styled like the Display
// Options panel (.overlay-controls in App.css). Purely presentational: the
// selection and the charges live in App.jsx.
//
// Every length is shown and typed in cm, like the coordinate readout
// (positions in state are in world units; see geometry.js's CM), and
// labeled "(cm)"; charges are in nC.
import { useState } from 'react';
import { CHARGE_SETTINGS, MAX_CHARGE_STEPS, chargeSteps, withChargeSteps } from './chargeTypes.js';
import { CM } from './geometry.js';
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

const WORLD_LIMIT_CM = WORLD_HALF_EXTENT / CM; // the box's edges, +/-10
const SIZE_LIMITS_CM = { min: 0.5, max: WORLD_LIMIT_CM }; // radii, thicknesses

const toCm = (world) => world / CM;
const toWorld = (cm) => cm * CM;

// A length in cm as text: whole numbers plainly, others to 2 decimals
// (trailing zeros dropped). (A plain hyphen for a minus sign: a number box
// takes nothing else.)
function formatCm(cm) {
  return String(Math.round(cm * 100) / 100);
}

// A row's label, with the unit of what's in it after it: "Radius (cm)".
function RowLabel({ text, unit = 'cm' }) {
  return (
    <span>
      {text} <span className="row-unit">({unit})</span>
    </span>
  );
}

// A number box with up and down arrows -- the browser's own number box,
// as in the other sims -- in cm. Typing is a draft, shown just as typed,
// until Enter or leaving the box commits it (committing every keystroke
// would move a charge to 1 on the way to 12); text that isn't a number
// puts the old value back. A step with the arrows, or the up and down
// keys, commits at once: those are the changes with no inputType, which
// only typing, pasting and deleting have. Either way the value is kept to
// [min, max].
//
// The arrows step by 1 cm, to whole multiples of it counted from
// `stepBase` (the box's own min, as far as the browser knows: 0 for a
// size, so a radius steps 1, 2, 3 rather than from its least, 0.5).
// `disabled` grays it out.
function NumberField({ label, cm, min, max, onCommit, disabled = false, stepBase = min }) {
  const [draft, setDraft] = useState(null);
  const commitValue = (text) => {
    const value = Number.parseFloat(text);
    setDraft(null);
    if (Number.isFinite(value)) onCommit(Math.min(max, Math.max(min, value)));
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        min={stepBase}
        max={max}
        step={1}
        value={draft ?? formatCm(cm)}
        disabled={disabled}
        onChange={(e) => {
          if (e.nativeEvent.inputType) setDraft(e.target.value);
          else commitValue(e.target.value);
        }}
        onBlur={() => { if (draft !== null) commitValue(draft); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

// A choice among a few options, as a row of joined toggle buttons;
// isDisabled(option) grays out the options that can't be chosen.
function Segmented({ options, value, onChange, isDisabled = () => false }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button type="button" key={v} className={v === value ? 'active' : ''} disabled={isDisabled(v)} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// The charge (or charge density) setting's value: "+3 nC", "−0.10 nC/cm",
// "+0.010 nC/cm²".
function ChargeValue({ charge }) {
  const { key, step, unit } = CHARGE_SETTINGS[charge.kind];
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const value = charge[key];
  return (
    <span className="stepper-value">
      {value > 0 ? '+' : '−'}{Math.abs(value).toFixed(decimals)} {unit}
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
// lockedAxis: while the 2D cut is viewed, its axis (0, 1 or 2): the
//   coordinate across the cut is grayed out, and so is turning a charged
//   plane parallel to the cut, since either would take the charge out of
//   the cut's mirror symmetry.
export default function PropertiesPanel({ charge, onChange, onDelete, onClose, lockedAxis = null }) {
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
  const setCoord = (k, cm) => {
    const position = [...charge.position];
    position[k] = toWorld(cm);
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
          <Segmented options={PLANE_NAMES.map((n, k) => [k, n])} value={charge.axis} onChange={setPlaneAxis} isDisabled={(axis) => axis === lockedAxis} />
        </div>
      )}

      <div className="property-row">
        <RowLabel text={kind === 'rod' ? 'Through' : kind === 'plane' ? 'At' : kind === 'sphere' ? 'Center' : 'Position'} />
        <div className="number-fields">
          {coords.map((k) => (
            <NumberField
              key={`${k}-${charge.id}`}
              label={AXIS_NAMES[k]}
              cm={toCm(charge.position[k])}
              min={-WORLD_LIMIT_CM}
              max={WORLD_LIMIT_CM}
              disabled={k === lockedAxis}
              onCommit={(cm) => setCoord(k, cm)}
            />
          ))}
        </div>
      </div>

      {(kind === 'sphere' || (kind === 'rod' && charge.form !== 'line')) && (
        <div className="property-row">
          <RowLabel text="Radius" />
          <div className="number-fields">
            <NumberField key={`radius-${charge.id}`} label="" cm={toCm(charge.radius)} {...SIZE_LIMITS_CM} stepBase={0} onCommit={(cm) => onChange({ radius: toWorld(cm) })} />
          </div>
        </div>
      )}
      {kind === 'plane' && charge.form === 'slab' && (
        <div className="property-row">
          <RowLabel text="Thickness" />
          <div className="number-fields">
            <NumberField key={`thickness-${charge.id}`} label="" cm={toCm(charge.thickness)} {...SIZE_LIMITS_CM} stepBase={0} onCommit={(cm) => onChange({ thickness: toWorld(cm) })} />
          </div>
        </div>
      )}

      <button type="button" className="control-button panel-delete-button" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

// A field probe's panel: where it is, and what it shows besides its arrow
// (each a checkbox, kept with the probe).
// probe: the selected probe (see probes.js). onChange(changes) /
// onDelete() / onClose(): as for a charge's panel; so is lockedAxis (a
// probe in the 2D cut's view stays in the cut). Its reading is in the
// Field Probes panel below.
export function ProbePanel({ probe, onChange, onDelete, onClose, lockedAxis = null }) {
  const setCoord = (k, cm) => {
    const position = [...probe.position];
    position[k] = toWorld(cm);
    onChange({ position });
  };
  return (
    <div className="overlay-controls properties-panel">
      <div className="panel-header">
        <h3>Field Probe {probe.label}</h3>
        <button type="button" className="panel-close-button" aria-label="Deselect" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="property-row">
        <RowLabel text="Position" />
        <div className="number-fields">
          {[0, 1, 2].map((k) => (
            <NumberField
              key={`${k}-${probe.id}`}
              label={AXIS_NAMES[k]}
              cm={toCm(probe.position[k])}
              min={-WORLD_LIMIT_CM}
              max={WORLD_LIMIT_CM}
              disabled={k === lockedAxis}
              onCommit={(cm) => setCoord(k, cm)}
            />
          ))}
        </div>
      </div>
      <label>
        <input type="checkbox" checked={probe.showComponents} onChange={(e) => onChange({ showComponents: e.target.checked })} />
        Show components
      </label>
      <label>
        <input type="checkbox" checked={probe.showFieldLine} onChange={(e) => onChange({ showFieldLine: e.target.checked })} />
        Show field line through it
      </label>
      <label>
        <input type="checkbox" checked={probe.showContributions} onChange={(e) => onChange({ showContributions: e.target.checked })} />
        Show each charge&apos;s contribution
      </label>
      <button type="button" className="control-button panel-delete-button" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

// The 2D cut's panel. Its orientation can be switched among the ones the
// charges allow (the others are grayed out), and its position typed in
// only when the charges allow it anywhere along its axis; otherwise it's
// shown, grayed out, at the one position they allow.
//
// cut: where the cut is (cutPlanes.js's placeCut). allowed: allowedCuts
// for the current charges. onChangeAxis(axis) / onChangeOffset(world) /
// onView() / onRemove() / onClose(): edits, viewing it in 2D, removing it,
// and deselecting. onView is null while the 2D view isn't available.
export function CutPanel({ cut, allowed, onChangeAxis, onChangeOffset, onView, onRemove, onClose }) {
  return (
    <div className="overlay-controls properties-panel">
      <div className="panel-header">
        <h3>2D Cut</h3>
        <button type="button" className="panel-close-button" aria-label="Deselect" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="property-row">
        <span>Parallel to</span>
        <Segmented
          options={PLANE_NAMES.map((n, k) => [k, n])}
          value={cut.axis}
          onChange={onChangeAxis}
          isDisabled={(axis) => allowed[axis].kind === 'none'}
        />
      </div>
      <div className="property-row">
        <RowLabel text="At" />
        <div className="number-fields">
          <NumberField
            key={`cut-${cut.axis}`}
            label={AXIS_NAMES[cut.axis]}
            cm={toCm(cut.offset)}
            min={-WORLD_LIMIT_CM}
            max={WORLD_LIMIT_CM}
            disabled={!cut.movable}
            onCommit={(cm) => onChangeOffset(toWorld(cm))}
          />
        </div>
      </div>
      {!cut.valid && <p className="panel-warning">The charges aren&apos;t all in this cut: move them back into it, or choose another orientation.</p>}
      <button type="button" className="control-button panel-wide-button" disabled={!onView || !cut.valid} onClick={onView}>
        View 2D cut
      </button>
      <button type="button" className="control-button panel-delete-button" onClick={onRemove}>
        Remove cut
      </button>
    </div>
  );
}
