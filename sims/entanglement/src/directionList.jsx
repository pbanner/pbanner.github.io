// UI for the shared analyzer direction list -- see directionListData.js for
// the plain { id, thetaDeg, phiDeg }[] shape this edits. Lives in the "Set
// Analyzer Direction" control-bar group (App.jsx), not the Source Controls
// sidebar: the list itself has nothing to do with which source is selected,
// only with how each analyzer's stepper is driven (Fixed mode's "Follow a
// list of directions" checkbox, or Random choice's per-side sampling row
// below) -- the Hidden Instruction Sets source just happens to be the one
// place that also *needs* a list like this to exist, and reads this same one
// rather than keeping a second copy (see instructionSets.jsx).

import { useState } from 'react';
import { MAX_DIRECTIONS } from './directionListData';

// One direction, shown as plain "Direction N: [theta]°, [phi]°" text until
// clicked, at which point the numbers become two small whole-degree inputs
// in place of themselves -- editing commits immediately (each input's own
// onChange), and clicking anywhere outside both inputs (Tab, click
// elsewhere, or Enter -- which just blurs the focused input, letting the
// container's own onBlur below take it from there) reverts to plain text.
function DirectionLabel({ index, direction, onEdit, disabled }) {
  const [editing, setEditing] = useState(false);
  const prefix = `• Direction ${index + 1}: `;

  if (!editing) {
    return (
      <span
        onClick={disabled ? undefined : () => setEditing(true)}
        title={disabled ? undefined : 'Click to edit'}
        style={{ cursor: disabled ? 'default' : 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}
      >
        <strong>{prefix}</strong>{direction.thetaDeg}°, {direction.phiDeg}°
      </span>
    );
  }

  return (
    <span
      style={{ display: 'inline-flex', gap: '3px', alignItems: 'center', fontSize: '13px', whiteSpace: 'nowrap' }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setEditing(false); }}
    >
      <strong>{prefix}</strong>
      <input
        type="number"
        min={0}
        max={180}
        step={1}
        value={direction.thetaDeg}
        autoFocus
        onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) onEdit(v, direction.phiDeg); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{ width: '36px', padding: '2px', fontSize: '12px' }}
      />
      °,
      <input
        type="number"
        min={0}
        max={360}
        step={1}
        value={direction.phiDeg}
        onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) onEdit(direction.thetaDeg, v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{ width: '36px', padding: '2px', fontSize: '12px' }}
      />
      °
    </span>
  );
}

// The direction picker itself: a click-to-edit "Direction N: t°, p°" per
// direction, with a delete (x) button pinned to the far right. Coded as a
// <table> (not visually styled as one) purely so each row's delete button
// can be pinned to the far right of the available width via a first cell set
// to width:'100%' -- the standard trick for "everything else at its natural
// width, one cell stretched to fill (and so push right) the rest."
export function DirectionList({ directions, onEditDirection, onDeleteDirection, onAddDirection, disabled }) {
  const canAdd = directions.length < MAX_DIRECTIONS;
  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {directions.map((dir, i) => (
            <tr key={dir.id}>
              <td style={{ width: '100%', padding: '0px 0' }}>
                <DirectionLabel index={i} direction={dir} disabled={disabled} onEdit={(t, p) => onEditDirection(dir.id, t, p)} />
              </td>
              <td style={{ padding: '0px 0 0px 6px', textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => onDeleteDirection(dir.id)}
                  disabled={disabled || directions.length <= 1}
                  title="Delete this direction"
                  aria-label={`Delete Direction ${i + 1}`}
                  style={{ width: '16px', height: '16px', padding: 0, lineHeight: '13px', fontSize: '11px', border: '1px solid #999', borderRadius: '2px', background: '#eee', cursor: 'pointer' }}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canAdd && (
        <div style={{ textAlign: 'right' }}>
          <button type="button" className="control-bar-button" onClick={onAddDirection} disabled={disabled} style={{ fontSize: '11px', margin: '6px 0 0 0' }}>
            + Add Direction
          </button>
        </div>
      )}
    </>
  );
}

// The "Follow a list of directions" stepper: cycles through 1..N over the
// shared direction list, with a live readout of that direction's own angle.
// Replaces the ordinary X/Y/Z AxisStepper (and its "Set by angles" button,
// which doesn't apply here -- every legal setting is already listed)
// whenever that checkbox is on, for *any* source -- not just Hidden
// Instruction Sets, which just happens to be the one source that also reads
// its own instructions from this same list.
export function DirectionListStepper({ label, directions, selectedId, onSelectDirection, disabled }) {
  const currentIndex = directions.findIndex((d) => d.id === selectedId);
  const index = currentIndex === -1 ? 0 : currentIndex;
  const direction = directions[index];

  const step = (delta) => {
    const nextIndex = (index + delta + directions.length) % directions.length;
    onSelectDirection(directions[nextIndex].id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', padding: '6px' }}>
      <label style={{ fontSize: '14px', fontWeight: '500', marginRight: '5px' }}>{label}</label>
      <div className="axis-stepper">
        <span className={`axis-stepper-value ${disabled ? 'disabled' : ''}`}>{index + 1}</span>
        <div className="axis-stepper-arrows">
          <button type="button" className="axis-stepper-arrow" onClick={() => step(1)} aria-label="Next direction" disabled={disabled}>▲</button>
          <button type="button" className="axis-stepper-arrow" onClick={() => step(-1)} aria-label="Previous direction" disabled={disabled}>▼</button>
        </div>
      </div>
      <span style={{ fontSize: '13px', color: '#666', whiteSpace: 'nowrap' }}>{direction.thetaDeg}°, {direction.phiDeg}°</span>
    </div>
  );
}

// Random choice's per-side row: one checkbox per shared direction, picking
// which of them this particular analyzer samples from (uniformly) each
// pair -- unlike the Fixed-mode stepper (which points at exactly one
// direction at a time), any number of these can be checked at once, and
// zero is the one state that has to be actively blocked (there'd be nothing
// left to sample), via the red outline + message below, same visual
// language as the instruction-set table's own duplicate-row message.
export function DirectionSamplingRow({ label, directions, selectedIds, onToggle, disabled }) {
  const isChecked = (id) => selectedIds.includes(id);
  const invalid = selectedIds.length === 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '6px' }}>
      <div
        style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
          ...(invalid ? { outline: '2px solid #cc3333', outlineOffset: '2px', borderRadius: '3px' } : {}),
        }}
      >
        <label style={{ fontSize: '14px', fontWeight: '500' }}>{label}</label>
        {directions.map((dir, i) => (
          <label key={dir.id} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={isChecked(dir.id)}
              onChange={(e) => onToggle(dir.id, e.target.checked)}
              disabled={disabled}
            />
            D{i + 1}
          </label>
        ))}
      </div>
      {invalid && (
        <p style={{ margin: '0 0 0 2px', color: '#cc3333', fontSize: '11px' }}>
          Select at least one direction for {label.toLowerCase()} to sample.
        </p>
      )}
    </div>
  );
}
