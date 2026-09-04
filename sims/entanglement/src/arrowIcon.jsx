// An up/down arrow as an inline SVG, for use in plain HTML/React content
// (table headers, ket labels) that can't call canvasArrow.js's canvas-only
// drawArrow. Reproduces that module's exact proportions so an arrow reads
// as the same shape wherever it shows up -- on-canvas bar/detector labels,
// the coincidence table's headers, and the source-controls sidebar's ket
// labels alike.
const ARROW_WIDTH_RATIO = 0.80;
const ARROW_HEAD_RATIO = 0.50;
const ARROW_STEM_RATIO = 0.16;

function arrowPathD(size, direction) {
  const headWidth = size * ARROW_WIDTH_RATIO;
  const headHeight = size * ARROW_HEAD_RATIO;
  const stemWidth = size * ARROW_STEM_RATIO;
  const stemHeight = size - headHeight;
  const half = size / 2;
  const base = direction === 'down' ? 0 : size;  // the flat (stem) end's y
  const tip = direction === 'down' ? size : 0;    // the pointed end's y
  const sign = direction === 'down' ? -1 : 1;
  const y1 = base;
  const y2 = base - sign * stemHeight;
  return [
    `M ${half - stemWidth / 2} ${y1}`,
    `L ${half - stemWidth / 2} ${y2}`,
    `L ${half - headWidth / 2} ${y2}`,
    `L ${half} ${tip}`,
    `L ${half + headWidth / 2} ${y2}`,
    `L ${half + stemWidth / 2} ${y2}`,
    `L ${half + stemWidth / 2} ${y1}`,
    'Z',
  ].join(' ');
}

export default function ArrowIcon({ direction, size = 12 }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'inline-block', verticalAlign: 'middle' }} aria-hidden="true">
      <path d={arrowPathD(size, direction)} fill="currentColor" />
    </svg>
  );
}
