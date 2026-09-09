// Small presentational controls shared between the sidebar (App.jsx) and
// the on-canvas field overlays (LabPanel.jsx) -- kept in their own module,
// like colors.js/canvasArrow.js, so neither of those two files has to
// import the other's internals just to reuse a slider or an axis stepper.
// Exports *only* components (constants live in axisOptions.js instead) so
// Vite's Fast Refresh can still hot-swap this file.

import { useState } from 'react';
import { SG_OPTION_LABELS, SG_OPTION_BASES, RAD_TO_DEG, DEG_TO_RAD, roundDeg } from './axisOptions';

// A plain <input type="number"> whose displayed text, while focused, is a
// local buffer rather than always mirroring the committed numeric value --
// binding `value` straight to that committed number (as every number input
// in this app used to) means the *browser* renders whatever the number
// coerces to on every keystroke: backspacing "30" down to "" hits a value
// nothing can parse, so the parsed-number guard everywhere skips committing
// anything, and React duly redraws the input with its last-good value --
// "30" pops right back before a replacement digit can ever land. Deferring
// the commit to blur (or Enter, which just blurs) instead means the field
// shows exactly whatever's been typed so far, valid or not, until the user
// actually finishes -- the same fix already used for the slider's own
// textbox below, generalized so every other plain number input in this app
// (Source Controls' weights, the direction list's angles, an instruction
// row's weight, an axis stepper's "Set by angles" boxes) can share it
// instead of re-implementing the same editing/textValue pair each time.
export function NumberField({ value, onCommit, parse = parseFloat, ...inputProps }) {
  const [editing, setEditing] = useState(false);
  const [textValue, setTextValue] = useState('');
  const displayValue = editing ? textValue : value;

  return (
    <input
      type="number"
      {...inputProps}
      value={displayValue}
      onFocus={() => { setTextValue(String(value)); setEditing(true); }}
      onChange={(e) => setTextValue(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const v = parse(textValue);
        if (!Number.isNaN(v)) onCommit(v);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

// A stepper through X/Y/Z (or, in `advanced` mode, raw theta/phi textboxes)
// for any [theta, phi] axis value. Deliberately knows nothing about *what*
// the axis belongs to (an analyzer's measurement basis, or one arm's field)
// -- callers wire that up themselves via onStep/onSetAdvanced/onSetAngle.
// `showAdvancedToggle` controls only whether the "Set by angles"/"Set by
// axis" button itself renders here -- a caller that wants that button
// somewhere else in its own layout (see AnalyzerStepper in App.jsx) passes
// showAdvancedToggle={false} and renders an equivalent button itself, while
// still driving `advanced` to switch between the two views below.
export function AxisStepper({ label, value, advanced, onStep, onSetAdvanced, onSetAngle, disabled, showAdvancedToggle = true }) {
  const currentIndex = SG_OPTION_BASES.findIndex(
    ([theta, phi]) => theta === value[0] && phi === value[1]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', padding: '6px' }}>
      <label style={{ fontSize: '14px', fontWeight: '500', marginRight: '5px' }}>{label}</label>
      {advanced ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ width: '12px' }}>θ</label>
            <NumberField
              min={0}
              max={180}
              step={1}
              value={roundDeg(value[0] * RAD_TO_DEG)}
              disabled={disabled}
              onCommit={(v) => onSetAngle('theta', v * DEG_TO_RAD)}
              style={{ width: '70px', padding: '2px' }}
            />
            <span>°</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ width: '12px' }}>ϕ</label>
            <NumberField
              min={0}
              max={360}
              step={1}
              value={roundDeg(value[1] * RAD_TO_DEG)}
              disabled={disabled}
              onCommit={(v) => onSetAngle('phi', v * DEG_TO_RAD)}
              style={{ width: '70px', padding: '2px' }}
            />
            <span>°</span>
          </div>
        </div>
      ) : (
        <div className="axis-stepper">
          <span className={`axis-stepper-value ${disabled ? 'disabled' : ''}`}>
            {currentIndex === -1 ? '?' : SG_OPTION_LABELS[currentIndex]}
          </span>
          <div className="axis-stepper-arrows">
            <button type="button" className="axis-stepper-arrow" onClick={() => onStep(1)} aria-label="Next axis" disabled={disabled}>▲</button>
            <button type="button" className="axis-stepper-arrow" onClick={() => onStep(-1)} aria-label="Previous axis" disabled={disabled}>▼</button>
          </div>
        </div>
      )}
      {/* marginLeft: auto pins this to the row's right edge regardless of
          whether the stepper or the (differently-sized) theta/phi textboxes
          are showing above, rather than sitting immediately after them. */}
      {showAdvancedToggle && (
        <button
          type="button"
          className={`control-bar-button advanced-toggle-button ${advanced ? 'active' : ''}`}
          aria-label={`Toggle advanced controls for ${label}`}
          onClick={() => onSetAdvanced(!advanced)}
          disabled={disabled}
          style={{ marginLeft: 'auto' }}
        >
          {advanced ? 'Set by axis' : 'Set by angles'}
        </button>
      )}
    </div>
  );
}

export function SliderPlusTextboxControl({ label, valueNum, onChangeNum, min, max, step, disabled = false }) {
  return (
    <div className="control-group">
      <label style={{ margin: '-0.25em 0em' }}>{label}</label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueNum}
          onChange={(e) => onChangeNum(parseFloat(e.target.value))}
          style={{ flex: 1 }}
          disabled={disabled}
        />
        <NumberField
          min={min}
          max={max}
          step={step}
          value={valueNum}
          onCommit={onChangeNum}
          style={{ width: '70px', padding: '2px' }}
          disabled={disabled}
        />
      </div>
    </div>
  );
}