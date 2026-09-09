// Non-component pieces of the "Classical: Hidden Instruction Sets" source's
// UI -- kept out of instructionSets.jsx (like axisOptions.js is kept out of
// controls.jsx) so that file can export *only* components, which is what
// lets Vite's Fast Refresh hot-swap them. See physics.js's own "Hidden
// instruction sets" section for the underlying math and the { rows } shape
// these helpers build and edit -- the *directions* rows carry signs for are
// no longer part of this shape at all: they're the single shared list
// App.jsx owns (directionListData.js), since Fixed mode's stepper and Random
// choice's per-side sampling both need that same list regardless of which
// source is selected. A "row" is one full instruction set:
// { id, signs: { [directionId]: 'up'|'down' }, weight }, with `weight`
// relative (not pre-normalized), same "up to normalization" contract as
// every other source in this sim.

let instructionRowIdCounter = 0;
function nextInstructionRowId() {
  instructionRowIdCounter += 1;
  return `row-${instructionRowIdCounter}`;
}

// A fresh single-row sheet for a freshly-created direction list: one
// instruction set (all "up"), weight irrelevant (and so disabled/shown as 1)
// since there's only one row.
export function createInitialInstructionSheet(directionIds) {
  return {
    rows: [{ id: nextInstructionRowId(), signs: Object.fromEntries(directionIds.map((id) => [id, 'up'])), weight: 1 }],
    generateAll: false,
    preGenerateRows: null,
  };
}

// Called whenever the shared direction list gains or loses a direction, so
// every row in every sheet (both particles, regardless of which is
// currently shown) stays fully specified -- a newly-added direction defaults
// to 'up' in every existing row, same as a freshly-added row defaults every
// column to 'up' in addInstructionRow below.
export function addSignToRows(rows, directionId) {
  return rows.map((row) => ({ ...row, signs: { ...row.signs, [directionId]: 'up' } }));
}

export function removeSignFromRows(rows, directionId) {
  return rows.map((row) => ({
    ...row,
    signs: Object.fromEntries(Object.entries(row.signs).filter(([id]) => id !== directionId)),
  }));
}

// Particle 2's read-only *view* under 'identical'/'opposite' -- not real
// state of its own, just Particle 1's own rows re-read (and, for 'opposite',
// every sign flipped). Recomputed fresh on every render rather than stored,
// since it's entirely determined by particle1 + relationship.
export function deriveTiedSheet(particle1, relationship) {
  const flip = relationship === 'opposite';
  return {
    rows: particle1.rows.map((row) => ({
      id: row.id,
      weight: row.weight,
      signs: flip
        ? Object.fromEntries(Object.entries(row.signs).map(([dirId, sign]) => [dirId, sign === 'up' ? 'down' : 'up']))
        : row.signs,
    })),
  };
}

// Every row sharing an identical +/- pattern across `directionIds` (a stale
// sign left over from a since-removed direction doesn't count, and neither
// does a direction this sheet isn't currently displaying -- see
// instructionSets.jsx's Independent-mode column trimming) -- returns the set
// of row ids that duplicate some other row, so every member of a matching
// group gets flagged, not just the second one onward (there's no natural
// "original" among otherwise-identical rows).
export function findDuplicateRowIds(rows, directionIds) {
  const seen = new Map();
  const duplicates = new Set();
  rows.forEach((row) => {
    const pattern = directionIds.map((id) => row.signs[id]).join('');
    if (seen.has(pattern)) {
      duplicates.add(seen.get(pattern));
      duplicates.add(row.id);
    } else {
      seen.set(pattern, row.id);
    }
  });
  return duplicates;
}

export function toggleInstructionSign(sheet, rowId, directionId) {
  return {
    ...sheet,
    rows: sheet.rows.map((row) => (row.id === rowId ? { ...row, signs: { ...row.signs, [directionId]: row.signs[directionId] === 'up' ? 'down' : 'up' } } : row)),
  };
}

export function changeInstructionWeight(sheet, rowId, weight) {
  return { ...sheet, rows: sheet.rows.map((row) => (row.id === rowId ? { ...row, weight } : row)) };
}

export function addInstructionRow(sheet, directionIds) {
  const signs = Object.fromEntries(directionIds.map((id) => [id, 'up']));
  return { ...sheet, rows: [...sheet.rows, { id: nextInstructionRowId(), signs, weight: 1 }] };
}

export function removeZeroWeightInstructionRows(sheet) {
  const kept = sheet.rows.filter((row) => row.weight !== 0);
  return kept.length > 0 ? { ...sheet, rows: kept } : sheet; // never remove down to zero rows
}

// Every possible instruction set over `directionIds` (2^n of them, n <=
// MAX_DIRECTIONS so at most 16), in a fixed binary order, each starting at
// equal (weight 1) -- "up to normalization" makes that already mean "all
// equally likely" without the user having to type anything. Directions not
// in `directionIds` (a direction this sheet isn't currently displaying, in
// Independent mode's column-trimmed view) are simply left at 'up' in every
// generated row -- irrelevant to this sheet's own outcomes unless that
// direction is later re-included. The row set this replaces is kept
// (`preGenerateRows`) so unchecking "Generate all possible sets" restores it
// exactly.
export function generateAllInstructionSets(sheet, directionIds, allDirectionIds) {
  const n = directionIds.length;
  const rows = [];
  for (let mask = 0; mask < (1 << n); mask++) {
    const signs = Object.fromEntries(allDirectionIds.map((id) => [id, 'up']));
    directionIds.forEach((id, i) => { signs[id] = (mask & (1 << i)) ? 'down' : 'up'; });
    rows.push({ id: nextInstructionRowId(), signs, weight: 1 });
  }
  return { ...sheet, generateAll: true, preGenerateRows: sheet.rows, rows };
}

export function restoreManualInstructionSets(sheet) {
  return { ...sheet, generateAll: false, rows: sheet.preGenerateRows ?? sheet.rows, preGenerateRows: null };
}
