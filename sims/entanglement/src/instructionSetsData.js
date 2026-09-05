// Non-component pieces of the "Classical: Hidden Instruction Sets" source's
// UI -- kept out of instructionSets.jsx (like axisOptions.js is kept out of
// controls.jsx) so that file can export *only* components, which is what
// lets Vite's Fast Refresh hot-swap them. See physics.js's own "Hidden
// instruction sets" section for the underlying math and the
// {columns, rows} shape these helpers build and edit.

export const MAX_INSTRUCTION_COLUMNS = 4;

let instructionIdCounter = 0;
function nextInstructionId(prefix) {
  instructionIdCounter += 1;
  return `${prefix}-${instructionIdCounter}`;
}

// A fresh single-column, single-row sheet -- the minimal starting point for
// either particle: one direction (Z), one instruction set (all "up"),
// weight irrelevant (and so disabled/shown as 1) since there's only one row.
export function createInitialInstructionSheet() {
  const columnId = nextInstructionId('col');
  return {
    columns: [{ id: columnId, thetaDeg: 0, phiDeg: 0 }],
    rows: [{ id: nextInstructionId('row'), signs: { [columnId]: 'up' }, weight: 1 }],
    generateAll: false,
    preGenerateRows: null,
  };
}

// Particle 2's read-only *view* under 'identical'/'opposite' -- not real
// state of its own, just Particle 1's own columns/rows re-read (and, for
// 'opposite', every sign flipped). Recomputed fresh on every render rather
// than stored, since it's entirely determined by particle1 + relationship.
export function deriveTiedSheet(particle1, relationship) {
  const flip = relationship === 'opposite';
  return {
    columns: particle1.columns,
    rows: particle1.rows.map((row) => ({
      id: row.id,
      weight: row.weight,
      signs: flip
        ? Object.fromEntries(Object.entries(row.signs).map(([colId, sign]) => [colId, sign === 'up' ? 'down' : 'up']))
        : row.signs,
    })),
  };
}

// Every row sharing an identical +/- pattern across the sheet's *current*
// columns (a stale sign left over from a since-deleted column doesn't
// count) -- returns the set of row ids that duplicate some other row, so
// every member of a matching group gets flagged, not just the second one
// onward (there's no natural "original" among otherwise-identical rows).
export function findDuplicateRowIds(rows, columns) {
  const columnIds = columns.map((c) => c.id);
  const seen = new Map();
  const duplicates = new Set();
  rows.forEach((row) => {
    const pattern = columnIds.map((id) => row.signs[id]).join('');
    if (seen.has(pattern)) {
      duplicates.add(seen.get(pattern));
      duplicates.add(row.id);
    } else {
      seen.set(pattern, row.id);
    }
  });
  return duplicates;
}

export function addInstructionColumn(sheet) {
  if (sheet.columns.length >= MAX_INSTRUCTION_COLUMNS) return sheet;
  const newColumn = { id: nextInstructionId('col'), thetaDeg: 0, phiDeg: 0 };
  return {
    ...sheet,
    columns: [...sheet.columns, newColumn],
    rows: sheet.rows.map((row) => ({ ...row, signs: { ...row.signs, [newColumn.id]: 'up' } })),
  };
}

export function deleteInstructionColumn(sheet, columnId) {
  if (sheet.columns.length <= 1) return sheet; // an analyzer always needs at least one direction to be set to
  return {
    ...sheet,
    columns: sheet.columns.filter((c) => c.id !== columnId),
    rows: sheet.rows.map((row) => ({
      ...row,
      signs: Object.fromEntries(Object.entries(row.signs).filter(([id]) => id !== columnId)),
    })),
  };
}

export function editInstructionColumn(sheet, columnId, thetaDeg, phiDeg) {
  return { ...sheet, columns: sheet.columns.map((c) => (c.id === columnId ? { ...c, thetaDeg, phiDeg } : c)) };
}

export function toggleInstructionSign(sheet, rowId, columnId) {
  return {
    ...sheet,
    rows: sheet.rows.map((row) => (row.id === rowId ? { ...row, signs: { ...row.signs, [columnId]: row.signs[columnId] === 'up' ? 'down' : 'up' } } : row)),
  };
}

export function changeInstructionWeight(sheet, rowId, weight) {
  return { ...sheet, rows: sheet.rows.map((row) => (row.id === rowId ? { ...row, weight } : row)) };
}

export function addInstructionRow(sheet) {
  const signs = Object.fromEntries(sheet.columns.map((c) => [c.id, 'up']));
  return { ...sheet, rows: [...sheet.rows, { id: nextInstructionId('row'), signs, weight: 1 }] };
}

export function removeZeroWeightInstructionRows(sheet) {
  const kept = sheet.rows.filter((row) => row.weight !== 0);
  return kept.length > 0 ? { ...sheet, rows: kept } : sheet; // never remove down to zero rows
}

// Every possible instruction set over the sheet's current columns (2^n of
// them, n <= MAX_INSTRUCTION_COLUMNS so at most 16), in a fixed binary
// order, each starting at equal (weight 1) -- "up to normalization" makes
// that already mean "all equally likely" without the user having to type
// anything. The row set this replaces is kept (`preGenerateRows`) so
// unchecking "Generate all possible sets" restores it exactly.
export function generateAllInstructionSets(sheet) {
  const n = sheet.columns.length;
  const rows = [];
  for (let mask = 0; mask < (1 << n); mask++) {
    const signs = {};
    sheet.columns.forEach((col, i) => { signs[col.id] = (mask & (1 << i)) ? 'down' : 'up'; });
    rows.push({ id: nextInstructionId('row'), signs, weight: 1 });
  }
  return { ...sheet, generateAll: true, preGenerateRows: sheet.rows, rows };
}

export function restoreManualInstructionSets(sheet) {
  return { ...sheet, generateAll: false, rows: sheet.preGenerateRows ?? sheet.rows, preGenerateRows: null };
}
