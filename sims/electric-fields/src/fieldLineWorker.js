// A Web Worker -- a script the browser runs on a thread of its own, beside
// the page's -- that traces field lines (fieldLines.js) for one moment of a
// run at a time, so that the page can keep drawing while it does. Several
// of them work at once (fieldLineWorkers.js).
//
// It's sent { id, sources, density, want3D, cut }: the charges whose field
// is drawn, as they are at that moment; the density setting; whether the
// 3D lines are wanted (not in the 2D cut's view); and the cut's
// { axis, offset }, if its lines are wanted (it's valid then), or null.
// It sends back { id, lines3D, cutLines, ms }: each set of lines packed
// (packFieldLines) or null, and how long the tracing took, in milliseconds.
// The packed arrays are transferred -- handed over to the page, not copied.
import { computeFieldLines, packFieldLines } from './fieldLines.js';
import { WORLD_HALF_EXTENT, CHARGE_RADIUS } from './sceneConstants.js';

self.onmessage = (event) => {
  const { id, sources, density, want3D, cut } = event.data;
  const started = performance.now();
  const trace = (cutPlane) => packFieldLines(computeFieldLines(sources, {
    density,
    halfExtent: WORLD_HALF_EXTENT,
    chargeRadius: CHARGE_RADIUS,
    cut: cutPlane,
  }));
  const lines3D = want3D ? trace(null) : null;
  const cutLines = cut ? trace(cut) : null;
  const transfer = [lines3D, cutLines].filter(Boolean).flatMap((packed) => [packed.segments.buffer, packed.arrows.buffer]);
  self.postMessage({ id, lines3D, cutLines, ms: performance.now() - started }, transfer);
};
