// The "Classical: Hidden Instruction Sets" source's own sidebar UI --
// Bell's local-hidden-variable model, made editable: a weighted list of full
// +/- answers ("rows", each one instruction set) over the shared analyzer
// direction list App.jsx owns (directionListData.js/directionList.jsx) --
// this source no longer keeps its own copy of that list, since Fixed mode's
// "Follow a list of directions" stepper and Random choice's per-side
// sampling both need the very same list regardless of which source is
// selected. Kept in its own module (like ket.jsx/TeX.jsx before it) since
// it's a large, self-contained piece of UI that App.jsx only needs to mount
// and hand state to -- see physics.js's own "Hidden instruction sets"
// section for the underlying math, and instructionSetsData.js for the
// { rows } shape this UI edits and every pure state-transition function
// below (toggle a sign, generate-all, ...) -- this file itself only knows
// how to render the state it's handed, not how to build it.

import {
  deriveTiedSheet,
  findDuplicateRowIds,
  toggleInstructionSign,
  changeInstructionWeight,
  addInstructionRow,
  removeZeroWeightInstructionRows,
  generateAllInstructionSets,
  restoreManualInstructionSets,
} from './instructionSetsData';
import { NumberField } from './controls';

// One instruction row: a clickable +/- toggle per (displayed) direction, a
// weight box, and (only when it duplicates another row) a message row
// directly beneath it -- rather than squeezed inline, which this sidebar's
// width can't spare.
function InstructionRow({ row, directions, readOnly, disabled, isDuplicate, soleRow, onToggleSign, onChangeWeight }) {
  const cellStyle = { border: '1px solid #ccc', padding: '2px 3px', textAlign: 'center' };
  return (
    <>
      <tr style={isDuplicate ? { outline: '2px solid #cc3333', outlineOffset: '-1px' } : undefined}>
        {directions.map((dir) => {
          const isUp = row.signs[dir.id] === 'up';
          return (
            <td key={dir.id} style={cellStyle}>
              <button
                type="button"
                onClick={readOnly || disabled ? undefined : () => onToggleSign(dir.id)}
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
          <NumberField
            step="0.01"
            value={soleRow ? 1 : row.weight}
            onCommit={onChangeWeight}
            disabled={readOnly || disabled || soleRow}
            style={{ width: '46px', padding: '2px', fontSize: '12px' }}
          />
        </td>
      </tr>
      {isDuplicate && (
        <tr>
          <td colSpan={directions.length + 1} style={{ border: 'none', padding: '1px 0 6px 0', color: '#cc3333', fontSize: '11px', textAlign: 'center' }}>
            This row is a duplicate of another row.
          </td>
        </tr>
      )}
    </>
  );
}

// The full row-table for one particle's sheet. `readOnly` renders Particle
// 2's tied (identical/opposite) view: same markup, but no sign/weight
// editing, no generate-all or add-row controls -- it's a pure display of
// what deriveTiedSheet computed. `allDirections` is the complete shared list
// (for the D-number a column header shows, and what a new row or a
// generated set gets fully specified over); `displayedDirectionIds` is
// which of those this particular sheet currently shows -- everything,
// except in Independent + Random-choice mode, where each side only shows
// the directions it currently samples (see App.jsx).
function SheetPanel({ sheet, setSheet, readOnly, noteText, disabled, resetDataCollection, allDirections, displayedDirectionIds }) {
  const { rows, generateAll } = sheet;
  const displayed = allDirections
    .map((dir, globalIndex) => ({ ...dir, globalIndex }))
    .filter((dir) => displayedDirectionIds.includes(dir.id));
  const allIds = allDirections.map((d) => d.id);
  const displayedIds = displayed.map((d) => d.id);

  const mutate = (fn) => {
    setSheet((prev) => fn(prev));
    resetDataCollection();
  };

  const duplicateIds = readOnly ? new Set() : findDuplicateRowIds(rows, displayedIds);
  const hasZeroWeightRow = !readOnly && rows.length > 1 && rows.some((r) => r.weight === 0);

  return (
    <>
      <p style={{ fontSize: '12px', color: '#666', margin: '0 0 8px 0', lineHeight: '1.3' }}>{noteText}</p>
      {/* width:100% + tableLayout:'fixed' spreads the table across the
          sidebar's full width rather than shrinking to its content's own
          (small) natural size -- fixed layout also means only the Weight
          column's own <col> needs a width; every other <col> is left
          unspecified so the browser divides the *remaining* width equally
          among however many directions are currently displayed. */}
      <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 4px 0', lineHeight: '1.3' }}>
        <strong>Instructions:</strong> directions are set in the Set Analyzer
        Direction panel below.
      </p>
      {!readOnly &&
        <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="checkbox"
            checked={generateAll}
            onChange={(e) => mutate((prev) => (e.target.checked ? generateAllInstructionSets(prev, displayedIds, allIds) : restoreManualInstructionSets(prev)))}
            disabled={disabled}
          />
          Show all possible instruction sets
        </label>
      }
      <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px' }}>
        <colgroup>
          {displayed.map((dir) => <col key={dir.id} />)}
          <col style={{ width: '60px' }} />
        </colgroup>
        <thead>
          <tr>
            {displayed.map((dir) => (
              <th key={dir.id} style={{ padding: '2px 3px', fontWeight: 600, textAlign: 'center' }}>D{dir.globalIndex + 1}</th>
            ))}
            <th style={{ padding: '2px 4px', fontWeight: 600, borderLeft: '2px solid #999' }}>Weight</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <InstructionRow
              key={row.id}
              row={row}
              directions={displayed}
              readOnly={readOnly}
              disabled={disabled}
              isDuplicate={duplicateIds.has(row.id)}
              soleRow={rows.length === 1}
              onToggleSign={(dirId) => mutate((prev) => toggleInstructionSign(prev, row.id, dirId))}
              onChangeWeight={(w) => mutate((prev) => changeInstructionWeight(prev, row.id, w))}
            />
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px', marginTop: '8px' }}>
          {!generateAll && (
            <button type="button" className="control-bar-button" onClick={() => mutate((prev) => addInstructionRow(prev, allIds))} disabled={disabled} style={{ fontSize: '12px' }}>
              + Add row
            </button>
          )}
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

// Top-level instruction-set controls: which of the three relationships ties
// Particle 2's sheet to Particle 1's, which sheet the sidebar is currently
// showing, and that sheet's own editor (or, when tied, its read-only view).
export default function InstructionSetControls({
  relationship, setRelationship,
  showing, setShowing,
  particle1, setParticle1,
  particle2, setParticle2,
  allDirections, displayedDirectionIds,
  disabled, resetDataCollection,
}) {
  const changeRelationship = (value) => { setRelationship(value); resetDataCollection(); };
  const isIndependent = relationship === 'independent';
  const showingParticle2 = showing === 'particle2';
  const allIds = allDirections.map((d) => d.id);

  let panelProps;
  if (showingParticle2 && isIndependent) {
    panelProps = {
      sheet: particle2, setSheet: setParticle2, readOnly: false,
      noteText: '', displayedDirectionIds: displayedDirectionIds[1],
    };
  } else if (showingParticle2) {
    panelProps = {
      sheet: deriveTiedSheet(particle1, relationship), setSheet: null, readOnly: true,
      noteText: relationship === 'identical'
        ? "Particle 2's instructions are exactly the same as Particle 1's."
        : "Particle 2's instructions are exact opposites of Particle 1's.",
      displayedDirectionIds: allIds,
    };
  } else {
    panelProps = {
      sheet: particle1, setSheet: setParticle1, readOnly: false,
      noteText: '', displayedDirectionIds: isIndependent ? displayedDirectionIds[0] : allIds,
    };
  }

  return (
    <>
      <p style={{ fontSize: '13px', margin: '10px 0 8px 0', lineHeight: '1.3' }}>
        <strong>This model:</strong> Each particle secretly carries a pre-determined answer for what they will do when they reach an analyzer at one of the directions you specify in the Set Analyzer Direction panel below.
      </p>
      <p style={{ fontSize: '12px', lineHeight: '1.4' }}><strong>Choose:</strong> How are the left-going and right-going particles' instruction sets related?</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0 6px 0' }}>
        <select
          value={relationship}
          onChange={(e) => changeRelationship(e.target.value)}
          disabled={disabled}
          style={{ flex: 1, fontSize: '12px', padding: '3px' }}
        >
          <option value="identical">They are the same</option>
          <option value="opposite">They are exact opposites</option>
          <option value="independent">They are independent</option>
        </select>
      </div>
      <hr style={{ margin: '6px 0px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 10px 0' }}>
        <label style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>Showing instructions for:</label>
        <select value={showing} onChange={(e) => setShowing(e.target.value)} style={{ flex: 1, fontSize: '12px', padding: '3px' }}>
          <option value="particle1">Particle 1</option>
          <option value="particle2">Particle 2</option>
        </select>
      </div>
      <SheetPanel {...panelProps} allDirections={allDirections} disabled={disabled} resetDataCollection={resetDataCollection} />
    </>
  );
}
