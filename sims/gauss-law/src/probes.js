// Field probes: markers that read the electric field where they are.
// App.jsx keeps them, ProbeMarker.jsx draws them, and the Field Probes
// panel lists their readings. Plain JS, no React.
//
// A probe isn't a charge: it doesn't add to the field, and no field lines
// start or end on it. Each is { id, label, position, showComponents,
// showFieldLine }: id 'probe-1', 'probe-2', ... (charges' ids are numbers,
// so the two never clash in the one selection), label a letter from A to
// Z, position in world units, placed and dragged just like a point charge,
// and what it shows besides its arrow, set in its properties panel.
import { fieldAt } from './chargeField.js';

// What the sidebar's probe button places (in the same form as
// chargeTypes.js's CHARGE_TYPES, so the sidebar and the placement ghost
// treat it like them).
export const PROBE_TYPE = { id: 'probe', label: 'Field Probe', kind: 'probe' };

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const MAX_PROBES = LABELS.length;

export const isProbeId = (id) => typeof id === 'string' && id.startsWith('probe-');

// The first letter no probe has (so deleting B and adding one brings B
// back), or null if they're all taken.
export function nextProbeLabel(probes) {
  return [...LABELS].find((label) => !probes.some((p) => p.label === label)) ?? null;
}

// How close counts as on something. Snapped positions land exactly on
// sheets and shells all the time; a probe placed freely (Alt) is never
// exactly on one, and the field just beside it is well defined.
const ON = 1e-9;

// Whether a probe is in the 2D cut ({ axis, offset }). While the cut is
// viewed, only those are shown.
export function probeInCut(probe, cut) {
  return Math.abs(probe.position[cut.axis] - cut.offset) < ON;
}

// What a probe at p is on, if anything, where the field has no single
// value: on a point charge or a thin rod's axis, where it's infinite, or
// on a charged sheet or shell, where it jumps from one value to another (by
// 4 pi sigma -- Gauss's law). A volume of charge (a solid or slab) has no
// such place: the field is the same on both sides of its surface.
function undefinedOn(source, p) {
  const distance = (c) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
  const fromAxis = () => Math.hypot(...p.map((v, k) => (k === source.axis ? 0 : v - source.position[k])));
  switch (source.kind) {
    case 'point':
      return distance(source.position) < ON ? 'a point charge' : null;
    case 'sphere':
      return source.form === 'shell' && Math.abs(distance(source.position) - source.radius) < ON ? "a charged sphere's shell" : null;
    case 'rod':
      if (source.form === 'line') return fromAxis() < ON ? 'a charged rod' : null;
      return source.form === 'shell' && Math.abs(fromAxis() - source.radius) < ON ? "a charged rod's shell" : null;
    case 'plane':
      return source.form === 'sheet' && Math.abs(p[source.axis] - source.position[source.axis]) < ON ? 'a charged plane' : null;
    default:
      return null;
  }
}

// The field at `position`: { field: [x, y, z], undefinedOn: null }, the
// field in chargeField.js's units -- or { field: null, undefinedOn }, with
// what it's on ("a point charge", ...) where it has no single value.
export function probeReading(sources, position) {
  for (const source of sources) {
    const on = undefinedOn(source, position);
    if (on) return { field: null, undefinedOn: on };
  }
  return { field: fieldAt(position, sources), undefinedOn: null };
}
