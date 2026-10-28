// The electric field drawn as arrows on a grid, the alternative to field
// lines. Plain JS, no React (FieldArrows.jsx draws them).
//
// The field is sampled at the centers of an n x n x n grid of cells filling
// the world cube, and each sample gets an arrow pointing along E. All the
// arrows are the same length: the field's strength falls off as 1/r^2, so
// lengths proportional to it would make a few huge arrows next to the
// charges and leave the rest too small to see. Instead strength is shown by
// shade, on a logarithmic scale between fixed limits (FAINTEST_FIELD and
// STRONGEST_FIELD), so a given strength always gets the same shade and the
// picture doesn't rescale itself as charges are dragged around.
import { fieldAt } from './fieldLines.js';

// Arrows per axis at each density setting (1-5): 27 to 1331 arrows. Always
// odd, so that the middle layer of arrows runs through the origin -- in
// particular, there's always a layer in the plane z = 0, where charges are
// placed. The same slider sets the field lines' density, so this must have
// as many entries as fieldLines.js's SEED_SETS.
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

// The spacing between neighboring arrows at a density setting, in world
// units (FieldArrows.jsx sizes the arrows from it).
export function arrowSpacing(density, halfExtent) {
  return (2 * halfExtent) / ARROWS_PER_AXIS[density - 1];
}

// sources: [{ position: [x, y, z], q }]. Returns
// [{ position, direction, strength }], direction a unit vector along E and
// strength from 0 (faintest) to 1 (strongest).
export function computeFieldArrows(sources, { density, halfExtent }) {
  if (sources.length === 0) return [];
  const n = ARROWS_PER_AXIS[density - 1];
  const spacing = arrowSpacing(density, halfExtent);
  const minDistance = MIN_DISTANCE_FROM_CHARGE * spacing;
  const logRange = Math.log(STRONGEST_FIELD / FAINTEST_FIELD);
  const arrows = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const position = [i, j, k].map((c) => -halfExtent + (c + 0.5) * spacing);
        const tooClose = sources.some((s) => Math.hypot(...position.map((v, m) => v - s.position[m])) < minDistance);
        if (tooClose) continue;
        const e = fieldAt(position, sources);
        const magnitude = Math.hypot(...e);
        if (!(magnitude > 0)) continue; // exactly where the field vanishes: no direction to show
        const strength = Math.min(1, Math.max(0, Math.log(magnitude / FAINTEST_FIELD) / logRange));
        arrows.push({ position, direction: e.map((c) => c / magnitude), strength });
      }
    }
  }
  return arrows;
}
