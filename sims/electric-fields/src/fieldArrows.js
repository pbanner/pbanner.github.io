// The electric field drawn as arrows on a grid, the alternative to field
// lines. Plain JS, no React (FieldArrows.jsx draws them).
//
// The field is sampled at the centers of an n x n x n grid of cells filling
// the world cube, and each sample gets an arrow pointing along E. Its
// length and shade both show the field's strength, but not in proportion
// to it: the strength falls off as 1/r^2, so proportional lengths would
// make a few huge arrows next to the charges and leave the rest too small
// to see. Instead both follow a logarithmic scale between fixed limits
// (FAINTEST_FIELD and STRONGEST_FIELD), so each doubling of the field adds
// the same amount of length and darkness, a given strength always looks
// the same, and the picture doesn't rescale itself as charges are dragged
// around.
import { balancedFieldAt } from './chargeField.js';

// Arrows per axis at each density setting (1-5): 27 to 1331 arrows. Always
// odd, so that the middle layer of arrows runs through the origin -- in
// particular, there's always a layer in the plane z = 0, where charges are
// placed. The same slider sets the field lines' density, so this must have
// as many entries as seedDirections.js's LINES_PER_UNIT_CHARGE.
const ARROWS_PER_AXIS = [3, 5, 7, 9, 11];
export const FIELD_ARROW_DENSITY_LEVELS = ARROWS_PER_AXIS.length;

// Field strengths (with the Coulomb constant and charge both 1, so |E| = 1
// at distance 1 from a lone charge) that get the faintest and the darkest
// shade; anything outside the range gets the nearer end.
const FAINTEST_FIELD = 0.01;
const STRONGEST_FIELD = 2;

// Samples closer than this (in units of the grid spacing) to a charge are
// skipped: the arrow would overlap the charge, where the field is huge and
// says nothing the charge itself doesn't.
const MIN_DISTANCE_FROM_CHARGE = 0.35;

// Where a field strength falls on that scale: 0 at FAINTEST_FIELD (or
// weaker), 1 at STRONGEST_FIELD (or stronger), and each doubling of the
// field the same step in between. A field probe's arrow (ProbeMarker.jsx)
// uses it too, so it's as long as an arrow here for the same field.
const LOG_RANGE = Math.log(STRONGEST_FIELD / FAINTEST_FIELD);
export function fieldStrengthFraction(magnitude) {
  return Math.min(1, Math.max(0, Math.log(magnitude / FAINTEST_FIELD) / LOG_RANGE));
}

// The spacing between neighboring arrows at a density setting, in world
// units (FieldArrows.jsx sizes the arrows from it).
export function arrowSpacing(density, halfExtent) {
  return (2 * halfExtent) / ARROWS_PER_AXIS[density - 1];
}

// sources: everything charged (see chargeField.js). Returns
// [{ position, direction, strength }], direction a unit vector along E and
// strength from 0 (faintest) to 1 (strongest).
//
// With `cut` ({ axis, offset }, a valid 2D cut), the arrows are a square
// grid in the cut instead -- the same spacing, one layer -- where the
// field lies along the cut.
export function computeFieldArrows(sources, { density, halfExtent, cut = null }) {
  if (sources.length === 0) return [];
  const n = ARROWS_PER_AXIS[density - 1];
  const spacing = arrowSpacing(density, halfExtent);
  const minDistance = MIN_DISTANCE_FROM_CHARGE * spacing;
  const arrows = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < (cut ? 1 : n); k++) {
        let position = [i, j, k].map((c) => -halfExtent + (c + 0.5) * spacing);
        if (cut) {
          // i and j run along the cut's two axes.
          const [u, v] = [0, 1, 2].filter((a) => a !== cut.axis);
          position = [0, 0, 0];
          position[cut.axis] = cut.offset;
          position[u] = -halfExtent + (i + 0.5) * spacing;
          position[v] = -halfExtent + (j + 0.5) * spacing;
        }
        const tooClose = sources.some((s) => s.kind === 'point' && Math.hypot(...position.map((v, m) => v - s.position[m])) < minDistance);
        if (tooClose) continue;
        const e = balancedFieldAt(position, sources);
        const magnitude = Math.hypot(...e);
        if (!(magnitude > 0)) continue; // exactly where the field vanishes: no direction to show
        arrows.push({ position, direction: e.map((c) => c / magnitude), strength: fieldStrengthFraction(magnitude) });
      }
    }
  }
  return arrows;
}
