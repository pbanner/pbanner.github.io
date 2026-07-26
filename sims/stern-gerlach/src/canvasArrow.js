// A solid, path-drawn up/down arrow, used in place of a Unicode arrow
// character in direction labels (e.g. "SG1<arrow>"). The natural fix for a
// too-thin arrow glyph is "pick a bolder Unicode arrow", but the bold
// arrows live in Supplemental Arrows-C (the U+1F800 block) -- a block
// sparsely covered by installed fonts. A missing glyph there renders as an
// empty box with no console warning, so on some browser/OS combinations
// the label would silently lose its arrow entirely. Drawing the arrow as
// vector shapes instead means it renders identically everywhere, with no
// font dependency at all.

const WIDTH_RATIO = 0.80; // full head width, as a fraction of the arrow's own height (size)
const HEAD_RATIO = 0.50;  // fraction of size occupied by the triangular head; the rest is stem
const STEM_RATIO = 0.16;  // stem width, as a fraction of size

// Width the arrow will occupy for a given size -- callers use this to lay
// out a "text + arrow" label without needing to know the shape's own
// proportions.
export function arrowWidth(size) {
  return size * WIDTH_RATIO;
}

// Draws a filled up/down arrow centered at (x, y); size is its height.
// Uses whatever ctx.fillStyle is already set, same as the text before it.
export function drawArrow(ctx, x, y, size, direction) {
  const headWidth = size * WIDTH_RATIO;
  const headHeight = size * HEAD_RATIO;
  const stemWidth = size * STEM_RATIO;
  const stemHeight = size - headHeight;

  ctx.save();
  ctx.translate(x, y);
  if (direction === 'down') ctx.scale(1, -1);
  ctx.beginPath();
  ctx.moveTo(-stemWidth / 2, size / 2);
  ctx.lineTo(-stemWidth / 2, size / 2 - stemHeight);
  ctx.lineTo(-headWidth / 2, size / 2 - stemHeight);
  ctx.lineTo(0, -size / 2);
  ctx.lineTo(headWidth / 2, size / 2 - stemHeight);
  ctx.lineTo(stemWidth / 2, size / 2 - stemHeight);
  ctx.lineTo(stemWidth / 2, size / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}