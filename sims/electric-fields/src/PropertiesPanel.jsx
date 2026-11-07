// The properties panel in the upper-right corner: the settings of whatever
// is selected -- a charge (PropertiesPanel), the 2D cut (CutPanel) or a
// field probe (ProbePanel) -- shown only while something is. Styled like the Display
// Options panel (.overlay-controls in App.css). Purely presentational: the
// selection and the charges live in App.jsx.
//
// Every length is shown and typed in cm, like the coordinate readout
// (positions in state are in world units; see geometry.js's CM), and
// labeled "(cm)"; charges are in nC, a free charge's mass in g, and its
// velocity in cm/s (in state, world units per second).
import { useState } from 'react';
import { CHARGE_SETTINGS, MAX_CHARGE_STEPS, chargeSteps, withChargeSteps, isFree, freeLabelText } from './chargeTypes.js';
import { CM } from './geometry.js';
import Segmented from './Segmented.jsx';
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

// A number as text: whole numbers plainly, others to 2 decimals (trailing
// zeros dropped). (A plain hyphen for a minus sign: a number box takes
// nothing else.)
function formatNumber(value) {
  return String(Math.round(value * 100) / 100);
}
// A mass in grams likewise -- except one under 0.01 g, which would round
// to 0, to 2 significant figures.
function formatMass(grams) {
  return grams >= 0.01 ? formatNumber(grams) : String(Number(grams.toPrecision(2)));
}

// A row's label, with the unit of what's in it after it: "Radius (cm)".
function RowLabel({ text, unit = 'cm' }) {
  return (
    <span>
      {text} <span className="row-unit">({unit})</span>
    </span>
  );
}

// A number box with up and down arrows -- a length in cm, a mass in g or a
// velocity in cm/s. The box itself is the browser's own number box -- so
// the up and down keys step it, and a tablet or phone offers a keyboard
// with digits -- but its arrows are drawn here: Safari on an iPad or
// iPhone doesn't draw a number box's arrows at all, so the browser's are
// hidden (App.css) and these stand in for them everywhere.
//
// Typing is a draft, shown just as typed, until Enter or leaving the box
// commits it (committing every keystroke would move a charge to 1 on the
// way to 12); text that isn't a number, or that `accept` turns down, puts
// the old value back. A step -- an arrow, or the up or down key -- commits
// at once. (The keys change the box with no inputType, which only typing,
// pasting and deleting have.) Either way the value is kept to [min, max]
// (unlimited by default).
//
// A step is `step` (1 by default), to the next whole multiple of it
// counted from `stepBase`, as the browser's own arrows would step: 0 for a
// size, so a radius steps 1, 2, 3 rather than from its least, 0.5, and
// 2.75 steps up to 3 or down to 2. Stepping down goes no lower than
// `stepMin` (min, by default), though a value typed below it is allowed:
// a mass can be typed as 0.05 g, but stepped down only to 0.1 g. `format`
// shows the value as text. `disabled` grays it out; `readOnly` leaves it
// looking as it is -- for values shown live during a run -- but it can't be
// typed in or stepped.
function NumberField({
  label, value, onCommit, min = -Infinity, max = Infinity, step = 1, stepBase = Number.isFinite(min) ? min : 0,
  stepMin = min, accept = () => true, format = formatNumber, disabled = false, readOnly = false,
}) {
  const [draft, setDraft] = useState(null);
  const commitValue = (text) => {
    const parsed = Number.parseFloat(text);
    setDraft(null);
    if (Number.isFinite(parsed) && accept(parsed)) onCommit(Math.min(max, Math.max(min, parsed)));
  };
  const stepBy = (direction) => {
    const current = Number.parseFloat(draft ?? format(value));
    if (!Number.isFinite(current)) return;
    const steps = (current - stepBase) / step;
    let next = stepBase + step * (direction > 0 ? Math.floor(steps + 1e-9) + 1 : Math.ceil(steps - 1e-9) - 1);
    next = Number(next.toFixed(10)); // 0.1 + 0.2 is 0.30000000000000004
    if (direction < 0 && next < stepMin) next = current > stepMin ? stepMin : current;
    commitValue(String(next));
  };
  return (
    <span className="number-field">
      <label>
        <span>{label}</span>
        <input
          type="number"
          // The browser's own stepping (the up and down keys) counts from
          // `min`, so that's stepBase, not the least value allowed -- and
          // there's none for a box with no least value (a velocity), which
          // the browser would otherwise hold above it.
          min={Number.isFinite(min) ? stepBase : undefined}
          max={Number.isFinite(max) ? max : undefined}
          step={step}
          value={draft ?? format(value)}
          disabled={disabled}
          readOnly={readOnly}
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
      {/* Outside the label, so the arrows aren't read out as part of the
          box's name; and left out of the Tab order (the up and down keys
          step a focused box). */}
      <span className="number-arrows">
        {[[+1, 'Increase'], [-1, 'Decrease']].map(([direction, action]) => (
          <button key={direction} type="button" tabIndex={-1} aria-label={`${action} ${label}`.trim()} disabled={disabled || readOnly} onClick={() => stepBy(direction)}>
            <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true" style={{ display: 'block', transform: direction > 0 ? undefined : 'rotate(180deg)' }}>
              <path d="M0 5 4 0 8 5Z" fill="currentColor" />
            </svg>
          </button>
        ))}
      </span>
    </span>
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

// A free charge's own settings (its part of PropertiesPanel):
//   - its mass, in g: the arrows step it by 0.1 g, down to 0.1 g, but
//     anything above 0 can be typed;
//   - its velocity, in cm/s, to start the run with;
//   - what to show: its path so far during a run, its predicted path (the
//     run worked out in advance: motion.js), and arrows along its velocity
//     and the force on it. These can be changed during a run too.
const MASS_STEP = 0.1;
//   In the 2D cut's view (lockedAxis), its velocity's part across the cut
//   is grayed out while it's 0, so that the charge keeps moving within the
//   cut; if it isn't 0 (set in 3D), it can still be changed, to 0.
function FreeChargeSettings({ charge, onChange, readOnly = false, lockedAxis = null }) {
  const setVelocity = (k, cmPerSecond) => {
    const velocity = [...charge.velocity];
    velocity[k] = toWorld(cmPerSecond);
    onChange({ velocity });
  };
  return (
    <>
      <div className="property-row">
        <RowLabel text="Mass" unit="g" />
        <div className="number-fields">
          <NumberField
            key={`mass-${charge.id}`}
            label=""
            value={charge.mass}
            step={MASS_STEP}
            stepBase={0}
            stepMin={MASS_STEP}
            accept={(grams) => grams > 0}
            format={formatMass}
            readOnly={readOnly}
            onCommit={(mass) => onChange({ mass })}
          />
        </div>
      </div>
      <div className="property-row">
        <RowLabel text="Velocity" unit="cm/s" />
        <div className="number-fields">
          {[0, 1, 2].map((k) => (
            <NumberField
              key={`v${k}-${charge.id}`}
              label={AXIS_NAMES[k]}
              value={toCm(charge.velocity[k])}
              disabled={k === lockedAxis && charge.velocity[k] === 0}
              readOnly={readOnly}
              onCommit={(v) => setVelocity(k, v)}
            />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: '20px', margin: '0.5em 0em' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {[
            ['showPath', 'Show path'],
            ['showPredictedPath', 'Show predicted path']
          ].map(([key, text]) => (
            <label key={key}>
              <input type="checkbox" checked={!!charge[key]} onChange={(e) => onChange({ [key]: e.target.checked })} />
              {text}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {[
            ['showVelocity', 'Show velocity'],
            ['showForce', 'Show force']
          ].map(([key, text]) => (
            <label key={key}>
              <input type="checkbox" checked={!!charge[key]} onChange={(e) => onChange({ [key]: e.target.checked })} />
              {text}
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

// charge: the selected charge (see chargeTypes.js).
// onChange(changes): new values for some of its fields.
// onSetFree(free): a point charge switched to free (true) or pinned.
// canBeFree: whether a pinned point charge can be switched to free (it
//   can't while it's against a wall: walls.js); `freeBlockedReason` says
//   why not, as the Free button's tooltip.
// onDelete() / onClose(): delete it, or deselect.
// lockedAxis: while the 2D cut is viewed, its axis (0, 1 or 2): the
//   coordinate across the cut is grayed out, and so is turning a charged
//   plane parallel to the cut, since either would take the charge out of
//   the cut's mirror symmetry.
// readOnly: during a run, when nothing that would change the run can be
//   changed: the panel shows the charge as it is at this moment (a free
//   one where it is now, going as fast as it is now), but only its display
//   options can be changed.
//
// A free point charge's panel also has its mass, its velocity (where it
// starts off, and how fast) and its display options (FreeChargeSettings).
export default function PropertiesPanel({ charge, onChange, onSetFree, onDelete, onClose, lockedAxis = null, canBeFree = true, freeBlockedReason, readOnly = false }) {
  const { kind } = charge;
  const free = isFree(charge);
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
        <h3>{TITLES[kind]}{free && ` ${freeLabelText(charge.freeLabel)}`}</h3>
        <button type="button" className="panel-close-button" aria-label="Deselect" onClick={onClose}>
          ×
        </button>
      </div>

      {kind === 'point' && (
        <div className="property-row">
          <span>Type</span>
          <Segmented
            options={[[false, 'Pinned'], [true, 'Free']]}
            value={free}
            onChange={onSetFree}
            isDisabled={(v) => readOnly || (v && !free && !canBeFree)}
            titleFor={(v) => (v && !free && !canBeFree ? freeBlockedReason : undefined)}
          />
        </div>
      )}

      <div className="property-row">
        <span>{label}</span>
        <div className="stepper">
          <button type="button" aria-label="Decrease charge" disabled={readOnly || steps <= -MAX_CHARGE_STEPS} onClick={() => onChange(withChargeSteps(charge, nextSteps(steps, -1)))}>
            −
          </button>
          <ChargeValue charge={charge} />
          <button type="button" aria-label="Increase charge" disabled={readOnly || steps >= MAX_CHARGE_STEPS} onClick={() => onChange(withChargeSteps(charge, nextSteps(steps, +1)))}>
            +
          </button>
        </div>
      </div>

      {FORMS[kind] && (
        <div className="property-row">
          <span>Form</span>
          <Segmented options={FORMS[kind]} value={charge.form} onChange={(form) => onChange({ form })} isDisabled={() => readOnly} />
        </div>
      )}

      {kind === 'rod' && (
        <div className="property-row">
          <span>Along</span>
          <Segmented options={AXIS_NAMES.map((n, k) => [k, n])} value={charge.axis} onChange={(axis) => onChange({ axis })} isDisabled={() => readOnly} />
        </div>
      )}
      {kind === 'plane' && (
        <div className="property-row">
          <span>Parallel to</span>
          <Segmented options={PLANE_NAMES.map((n, k) => [k, n])} value={charge.axis} onChange={setPlaneAxis} isDisabled={(axis) => readOnly || axis === lockedAxis} />
        </div>
      )}

      <div className="property-row">
        <RowLabel text={kind === 'rod' ? 'Through' : kind === 'plane' ? 'At' : kind === 'sphere' ? 'Center' : 'Position'} />
        <div className="number-fields">
          {coords.map((k) => (
            <NumberField
              key={`${k}-${charge.id}`}
              label={AXIS_NAMES[k]}
              value={toCm(charge.position[k])}
              min={-WORLD_LIMIT_CM}
              max={WORLD_LIMIT_CM}
              disabled={k === lockedAxis}
              readOnly={readOnly}
              onCommit={(cm) => setCoord(k, cm)}
            />
          ))}
        </div>
      </div>

      {free && <FreeChargeSettings charge={charge} onChange={onChange} readOnly={readOnly} lockedAxis={lockedAxis} />}

      {(kind === 'sphere' || (kind === 'rod' && charge.form !== 'line')) && (
        <div className="property-row">
          <RowLabel text="Radius" />
          <div className="number-fields">
            <NumberField key={`radius-${charge.id}`} label="" value={toCm(charge.radius)} {...SIZE_LIMITS_CM} stepBase={0} readOnly={readOnly} onCommit={(cm) => onChange({ radius: toWorld(cm) })} />
          </div>
        </div>
      )}
      {kind === 'plane' && charge.form === 'slab' && (
        <div className="property-row">
          <RowLabel text="Thickness" />
          <div className="number-fields">
            <NumberField key={`thickness-${charge.id}`} label="" value={toCm(charge.thickness)} {...SIZE_LIMITS_CM} stepBase={0} readOnly={readOnly} onCommit={(cm) => onChange({ thickness: toWorld(cm) })} />
          </div>
        </div>
      )}

      <button type="button" className="control-button panel-delete-button" disabled={readOnly} onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

// A field probe's panel: where it is, and what it shows besides its arrow
// (each a checkbox, kept with the probe).
// probe: the selected probe (see probes.js). onChange(changes) /
// onDelete() / onClose(): as for a charge's panel; so is lockedAxis (a
// probe in the 2D cut's view stays in the cut), and so is readOnly (during
// a run, only what it shows can be changed). Its reading is in the Field
// Probes panel below.
export function ProbePanel({ probe, onChange, onDelete, onClose, lockedAxis = null, readOnly = false }) {
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
              value={toCm(probe.position[k])}
              min={-WORLD_LIMIT_CM}
              max={WORLD_LIMIT_CM}
              disabled={k === lockedAxis}
              readOnly={readOnly}
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
      <button type="button" className="control-button panel-delete-button" disabled={readOnly} onClick={onDelete}>
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
// readOnly: during a run, when the cut can't be changed or removed.
export function CutPanel({ cut, allowed, onChangeAxis, onChangeOffset, onView, onRemove, onClose, readOnly = false }) {
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
          isDisabled={(axis) => readOnly || allowed[axis].kind === 'none'}
        />
      </div>
      <div className="property-row">
        <RowLabel text="At" />
        <div className="number-fields">
          <NumberField
            key={`cut-${cut.axis}`}
            label={AXIS_NAMES[cut.axis]}
            value={toCm(cut.offset)}
            min={-WORLD_LIMIT_CM}
            max={WORLD_LIMIT_CM}
            disabled={!cut.movable}
            readOnly={readOnly}
            onCommit={(cm) => onChangeOffset(toWorld(cm))}
          />
        </div>
      </div>
      {!cut.valid && <p className="panel-warning">The charges aren&apos;t all in this cut: move them back into it, or choose another orientation.</p>}
      <button type="button" className="control-button panel-wide-button" disabled={!onView || !cut.valid} onClick={onView}>
        View 2D cut
      </button>
      <button type="button" className="control-button panel-delete-button" disabled={readOnly} onClick={onRemove}>
        Remove cut
      </button>
    </div>
  );
}
