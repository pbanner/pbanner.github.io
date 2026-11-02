// Which 2D cuts an arrangement of charges allows. Plain JS, no React.
//
// A 2D cut is a plane perpendicular to one of the axes -- x, y or z, the
// cut's `axis` (0, 1 or 2) -- at some position along it, its `offset`:
// the cut parallel to the xy plane at z = 1 is { axis: 2, offset: 1 }.
// It shows the field lines lying in that plane, and those are true field
// lines (not projections of lines that wander out of the plane) only if
// the field there has no component across the plane. That's guaranteed
// when the arrangement is mirror-symmetric through the plane: reflecting
// it through the plane leaves it the same, so it must leave the field the
// same too, but the reflection flips the field's component across the
// plane -- so on the plane itself, that component is 0.
//
// The arrangement is mirror-symmetric when each charge is, so each charge
// on its own allows cuts at one position, at any position, or at none.
// For cuts perpendicular to the axis `a`:
//   - a point charge or sphere: only through it, offset = its coordinate
//     along a;
//   - a rod along a, crossing the cut at right angles: any offset (the
//     infinite rod reflects onto itself);
//   - a rod across a: only with its axis in the cut (one above the cut
//     would reflect to one below it);
//   - a plane containing a (perpendicular to the cut): any offset;
//   - a sheet or slab parallel to the cut: none. Its field points straight
//     across the cut. (A slab centered on the cut is mirror-symmetric, but
//     its own field is 0 in its middle plane, so the cut would show
//     nothing of it; it's left out too.)
// The arrangement allows what all of its charges allow: no constraint
// combined with offset c gives c, offset c with the same c gives c, two
// different offsets or any "none" give none.
//
// When nothing pins the offset down -- every charge is a rod along a or a
// plane containing a -- the whole arrangement is the same all along a, so
// every such cut shows exactly the same picture.

// Offsets closer than this are the same (positions are snapped to ticks,
// but a charge placed with Alt can be anywhere).
const SAME_OFFSET = 1e-6;

// What one charge allows for cuts perpendicular to `axis`: 'any', 'none'
// or the one offset (a number).
function chargeAllows(charge, axis) {
  if (charge.kind === 'rod' && charge.axis === axis) return 'any';
  if (charge.kind === 'plane') return charge.axis === axis ? 'none' : 'any';
  return charge.position[axis]; // a point charge, a sphere, or a rod across the axis
}

// What the whole arrangement allows for cuts perpendicular to `axis`:
// { kind: 'any' }, { kind: 'one', offset } or { kind: 'none' }.
export function allowedCut(charges, axis) {
  let offset = null;
  for (const charge of charges) {
    const allows = chargeAllows(charge, axis);
    if (allows === 'none') return { kind: 'none' };
    if (allows === 'any') continue;
    if (offset === null) offset = allows;
    else if (Math.abs(allows - offset) > SAME_OFFSET) return { kind: 'none' };
  }
  return offset === null ? { kind: 'any' } : { kind: 'one', offset };
}

// allowedCut for each axis, x, y and z.
export function allowedCuts(charges) {
  return [0, 1, 2].map((axis) => allowedCut(charges, axis));
}

// Which orientation a new cut takes, the first allowed of: parallel to xy
// (charges are placed on the floor, z = 0, unless lifted), then xz, then
// yz. null if none is allowed.
const CUT_PREFERENCE = [2, 1, 0];
export function defaultCutAxis(allowed) {
  return CUT_PREFERENCE.find((axis) => allowed[axis].kind !== 'none') ?? null;
}

// Where a cut actually is: at the arrangement's one allowed offset, if
// it has one, or else wherever the cut was put (`cut.offset`). Also
// whether it's valid -- whether its orientation is allowed at all.
export function placeCut(cut, allowed) {
  const a = allowed[cut.axis];
  return {
    axis: cut.axis,
    offset: a.kind === 'one' ? a.offset : cut.offset,
    valid: a.kind !== 'none',
    // Whether its position can be chosen: only when any offset is allowed.
    movable: a.kind === 'any',
  };
}
