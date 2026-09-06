// The "Classical: Hidden Instruction Sets" source's own sidebar UI --
// Bell's local-hidden-variable model, made editable: a table of user-chosen
// analyzer directions ("columns") and a weighted list of full +/- answers
// for each of them ("rows", each one instruction set). Kept in its own
// module (like ket.jsx/TeX.jsx before it) since it's a large, self-contained
// piece of UI that App.jsx only needs to mount and hand state to -- see
// physics.js's own "Hidden instruction sets" section for the underlying
// math, and instructionSetsData.js for the {columns, rows} shape this UI
// edits and every pure state-transition function below (add/delete/edit a
// column, toggle a sign, generate-all, ...) -- this file itself only knows
// how to render the state it's handed, not how to build it.

import { useState } from 'react';
import {
  MAX_INSTRUCTION_COLUMNS,
  deriveTiedSheet,
  findDuplicateRowIds,
  addInstructionColumn,
  deleteInstructionColumn,
  editInstructionColumn,
  toggleInstructionSign,
  changeInstructionWeight,
  addInstructionRow,
  removeZeroWeightInstructionRows,
  generateAllInstructionSets,
  restoreManualInstructionSets,
} from './instructionSetsData';

// One direction, shown as plain "Direction N: [theta]°, [phi]°" text until
// clicked, at which point the numbers become two small whole-degree inputs
// in place of themselves -- editing commits immediately (each input's own
// onChange), and clicking anywhere outside both inputs (Tab, click
// elsewhere, or Enter -- which just blurs the focused input, letting the
// container's own onBlur below take it from there) reverts to plain text.
function DirectionLabel({ index, column, onEdit, disabled }) {
  const [editing, setEditing] = useState(false);
  const prefix = `Direction ${index + 1}: `;

  if (!editing) {
    return (
      <span
        onClick={disabled ? undefined : () => setEditing(true)}
        title={disabled ? undefined : 'Click to edit'}
        style={{ cursor: disabled ? 'default' : 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}
      >
        {prefix}{column.thetaDeg}°, {column.phiDeg}°
      </span>
    );
  }

  return (
    <span
      style={{ display: 'inline-flex', gap: '3px', alignItems: 'center', fontSize: '13px', whiteSpace: 'nowrap' }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setEditing(false); }}
    >
      {prefix}
      <input
        type="number"
        min={0}
        max={180}
        step={1}
        value={column.thetaDeg}
        autoFocus
        onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) onEdit(v, column.phiDeg); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{ width: '36px', padding: '2px', fontSize: '12px' }}
      />
      °,
      <input
        type="number"
        min={0}
        max={360}
        step={1}
        value={column.phiDeg}
        onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) onEdit(column.thetaDeg, v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{ width: '36px', padding: '2px', fontSize: '12px' }}
      />
      °
    </span>
  );
}

// The direction picker, separated out from the instruction-set table itself
// (which now just labels its columns D1..D4) since the table's own width is
// the tight resource in this sidebar: a click-to-edit "Direction N: t°, p°"
// per direction reads however wide it needs to, entirely independent of how
// many narrow sign-toggle columns the table below ends up with. Coded as a
// <table> (not visually styled as one) purely so each row's delete button
// can be pinned to the far right of the sidebar's own width via a first
// cell set to width:'100%' -- the standard trick for "everything else at
// its natural width, one cell stretched to fill (and so push right) the
// rest."
function DirectionList({ columns, generateAll, onEditColumn, onDeleteColumn, onAddColumn, disabled }) {
  const canAdd = !generateAll && columns.length < MAX_INSTRUCTION_COLUMNS;
  return (
    <>
      <p style={{ fontSize: '12px', color: '#666', margin: '0 0 6px 0', lineHeight: '1.4' }}>
        Specify the directions that particles have instructions for:
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {columns.map((col, i) => (
            <tr key={col.id}>
              <td style={{ width: '100%', padding: '2px 0' }}>
                <DirectionLabel index={i} column={col} disabled={disabled} onEdit={(t, p) => onEditColumn(col.id, t, p)} />
              </td>
              <td style={{ padding: '2px 0 2px 6px', textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => onDeleteColumn(col.id)}
                  disabled={disabled || generateAll || columns.length <= 1}
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
        <button type="button" className="control-bar-button" onClick={onAddColumn} disabled={disabled} style={{ fontSize: '12px', margin: '6px 0 10px 0' }}>
          + Add Direction
        </button>
      )}
    </>
  );
}

// One instruction row: a clickable +/- toggle per column, a weight box, and
// (only when it duplicates another row) a message row directly beneath it
// -- rather than squeezed inline, which this sidebar's width can't spare.
function InstructionRow({ row, columns, readOnly, disabled, isDuplicate, soleRow, onToggleSign, onChangeWeight }) {
  const cellStyle = { border: '1px solid #ccc', padding: '2px 3px', textAlign: 'center' };
  return (
    <>
      <tr style={isDuplicate ? { outline: '2px solid #cc3333', outlineOffset: '-1px' } : undefined}>
        {columns.map((col) => {
          const isUp = row.signs[col.id] === 'up';
          return (
            <td key={col.id} style={cellStyle}>
              <button
                type="button"
                onClick={readOnly || disabled ? undefined : () => onToggleSign(col.id)}
                disabled={readOnly || disabled}
                aria-label={isUp ? 'Instructed +; click to flip to -' : 'Instructed -; click to flip to +'}
                style={{
                  width: '19px', height: '18px', padding: 0, fontSize: '12px', fontWeight: 700,
                  border: '1px solid #999', borderRadius: '3px',
                  background: isUp ? '#eaf3ea' : '#f6eaea', color: '#333',
                  cursor: readOnly || disabled ? 'default' : 'pointer',
                }}
              >
                {isUp ? '+' : '−'}
              </button>
            </td>
          );
        })}
        <td style={{ ...cellStyle, padding: '2px 4px', borderLeft: '2px solid #999' }}>
          <input
            type="number"
            step="0.01"
            value={soleRow ? 1 : row.weight}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChangeWeight(v); }}
            disabled={readOnly || disabled || soleRow}
            style={{ width: '46px', padding: '2px', fontSize: '12px' }}
          />
        </td>
      </tr>
      {isDuplicate && (
        <tr>
          <td colSpan={columns.length + 1} style={{ border: 'none', padding: '1px 0 6px 0', color: '#cc3333', fontSize: '11px', textAlign: 'center' }}>
            This row is a duplicate of another row.
          </td>
        </tr>
      )}
    </>
  );
}

// The full column-table-plus-row-table for one particle's sheet. `readOnly`
// renders Particle 2's tied (identical/opposite) view: same markup, but no
// column add/delete, no sign/weight editing, no generate-all or add-row
// controls -- it's a pure display of what deriveTiedSheet computed.
function SheetPanel({ sheet, setSheet, readOnly, noteText, disabled, resetDataCollection }) {
  const { columns, rows, generateAll } = sheet;

  const mutate = (fn) => {
    setSheet((prev) => fn(prev));
    resetDataCollection();
  };

  const duplicateIds = readOnly ? new Set() : findDuplicateRowIds(rows, columns);
  const hasZeroWeightRow = !readOnly && rows.length > 1 && rows.some((r) => r.weight === 0);

  return (
    <>
      <p style={{ fontSize: '12px', color: '#666', margin: '0 0 8px 0', lineHeight: '1.5' }}>{noteText}</p>
      {!readOnly && (
        <DirectionList
          columns={columns}
          generateAll={generateAll}
          disabled={disabled}
          onEditColumn={(colId, t, p) => mutate((prev) => editInstructionColumn(prev, colId, t, p))}
          onDeleteColumn={(colId) => mutate((prev) => deleteInstructionColumn(prev, colId))}
          onAddColumn={() => mutate(addInstructionColumn)}
        />
      )}
      {/* width:100% + tableLayout:'fixed' spreads the table across the
          sidebar's full width rather than shrinking to its content's own
          (small) natural size -- fixed layout also means only the Weight
          column's own <col> needs a width; every other <col> is left
          unspecified so the browser divides the *remaining* width equally
          among however many directions there currently are. */}
      <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px' }}>
        <colgroup>
          {columns.map((col) => <col key={col.id} />)}
          <col style={{ width: '60px' }} />
        </colgroup>
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={col.id} style={{ padding: '2px 3px', fontWeight: 600 }}>D{i + 1}</th>
            ))}
            <th style={{ padding: '2px 4px', fontWeight: 600, borderLeft: '2px solid #999' }}>Weight</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <InstructionRow
              key={row.id}
              row={row}
              columns={columns}
              readOnly={readOnly}
              disabled={disabled}
              isDuplicate={duplicateIds.has(row.id)}
              soleRow={rows.length === 1}
              onToggleSign={(colId) => mutate((prev) => toggleInstructionSign(prev, row.id, colId))}
              onChangeWeight={(w) => mutate((prev) => changeInstructionWeight(prev, row.id, w))}
            />
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px', marginTop: '8px' }}>
          {!generateAll && (
            <button type="button" className="control-bar-button" onClick={() => mutate(addInstructionRow)} disabled={disabled} style={{ fontSize: '12px' }}>
              + Add row
            </button>
          )}
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="checkbox"
              checked={generateAll}
              onChange={(e) => mutate(e.target.checked ? generateAllInstructionSets : restoreManualInstructionSets)}
              disabled={disabled}
            />
            Generate all possible sets
          </label>
          {hasZeroWeightRow && (
            <button type="button" className="control-bar-button" onClick={() => mutate(removeZeroWeightInstructionRows)} disabled={disabled} style={{ fontSize: '12px' }}>
              Remove rows with weight 0
            </button>
          )}
        </div>
      )}
    </>
  );
}

// The locked analyzer stepper for this source: cycles through 1..N over
// whichever column list is currently relevant to this side (App.jsx decides
// that -- Particle 1's shared columns, or, in Independent mode, each
// particle's own), with a live readout of that column's own direction.
// Replaces the ordinary X/Y/Z AxisStepper (and its "Set by angles" button,
// which doesn't apply here -- every legal setting is already listed)
// whenever "Fix directions to instruction table" is checked.
export function InstructionColumnStepper({ label, columns, selectedColumnId, onSelectColumn, disabled }) {
  const currentIndex = columns.findIndex((c) => c.id === selectedColumnId);
  const index = currentIndex === -1 ? 0 : currentIndex;
  const column = columns[index];

  const step = (delta) => {
    const nextIndex = (index + delta + columns.length) % columns.length;
    onSelectColumn(columns[nextIndex].id);
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
      <span style={{ fontSize: '13px', color: '#666', whiteSpace: 'nowrap' }}>{column.thetaDeg}°, {column.phiDeg}°</span>
    </div>
  );
}

// Top-level instruction-set controls: which of the three relationships ties
// Particle 2's sheet to Particle 1's, which sheet the sidebar is currently
// showing, and that sheet's own editor (or, when tied, its read-only view).
export default function InstructionSetControls({
  relationship, setRelationship,
  showing, setShowing,
  particle1, setParticle1,
  particle2, setParticle2,
  disabled, resetDataCollection,
}) {
  const changeRelationship = (value) => { setRelationship(value); resetDataCollection(); };
  const isIndependent = relationship === 'independent';
  const showingParticle2 = showing === 'particle2';

  let panelProps;
  if (showingParticle2 && isIndependent) {
    panelProps = {
      sheet: particle2, setSheet: setParticle2, readOnly: false,
      noteText: "Particle 2's own, independently-drawn sheet -- its directions and instruction sets don't have to match Particle 1's at all.",
    };
  } else if (showingParticle2) {
    panelProps = {
      sheet: deriveTiedSheet(particle1, relationship), setSheet: null, readOnly: true,
      noteText: relationship === 'identical'
        ? "Particle 2 carries an identical copy of Particle 1's sheet."
        : "Particle 2 carries Particle 1's sheet with every + and − flipped.",
    };
  } else {
    panelProps = {
      sheet: particle1, setSheet: setParticle1, readOnly: false,
      noteText: 'Each row is one full set of instructions -- what this particle reports at every direction below -- weighted by how likely a pair is to carry it.',
    };
  }

  return (
    <>
      <p style={{ fontSize: '13px', margin: '10px 0 8px 0', lineHeight: '1.6' }}>
        Each particle secretly carries a predetermined answer for every
        direction below -- Bell's own "local hidden variable" model.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 6px 0' }}>
        <label style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>Particle 2's sheet:</label>
        <select
          value={relationship}
          onChange={(e) => changeRelationship(e.target.value)}
          disabled={disabled}
          style={{ flex: 1, fontSize: '12px', padding: '3px' }}
        >
          <option value="identical">Identical to Particle 1</option>
          <option value="opposite">Opposite of Particle 1</option>
          <option value="independent">Independent</option>
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 10px 0' }}>
        <label style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>Showing:</label>
        <select value={showing} onChange={(e) => setShowing(e.target.value)} style={{ flex: 1, fontSize: '12px', padding: '3px' }}>
          <option value="particle1">Particle 1</option>
          <option value="particle2">Particle 2</option>
        </select>
      </div>
      <SheetPanel {...panelProps} disabled={disabled} resetDataCollection={resetDataCollection} />
    </>
  );
}
