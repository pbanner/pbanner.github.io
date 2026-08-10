// A solid, path-drawn Dirac ket "|+>" / "|->" -- the angle bracket drawn as
// a "⟩"-shaped chevron -- used in place of the Unicode "|" and "⟩"
// characters. Same reasoning as canvasArrow.js's hand-drawn arrow: the
// vertical reach of "|" and "⟩" above/below the surrounding characters is a
// font-metric detail with no consistent cross-platform behavior under
// ctx.fillText, so drawing them as vector shapes means the ket's vertical
// alignment is decided entirely by this file, identically on every
// machine. The ket only ever needs to hold "+" or "-", so both signs are
// hand-drawn too, rather than mixing drawn brackets with a text-rendered
// sign that wouldn't share their vertical geometry.

const LINE_THICKNESS_RATIO = 0.10;    // "|" and "⟩" stroke thickness, as a fraction of size
const GAP_RATIO = 0.16;               // spacing between "|", the sign, and "⟩", as a fraction of size
const SIGN_SIZE_RATIO = 0.46;         // +/- extent, as a fraction of size
const SIGN_THICKNESS_RATIO = 0.10;    // +/- stroke thickness, as a fraction of size
const CHEVRON_WIDTH_RATIO = 0.30;     // "⟩" horizontal reach, as a fraction of size

// Total width the ket occupies for a given size -- callers use this to lay
// out "ket + subscript" without needing to know the shape's own internal
// proportions.
export function ketWidth(size) {
  return size * (LINE_THICKNESS_RATIO + GAP_RATIO + SIGN_SIZE_RATIO + GAP_RATIO + CHEVRON_WIDTH_RATIO);
}

// Draws a filled "|+>" or "|->" with its left edge at x, vertically centered
// on y; size is its height. Uses whatever ctx.fillStyle is already set.
export function drawKet(ctx, x, y, size, sign) {
  const lineT = size * LINE_THICKNESS_RATIO;
  const gap = size * GAP_RATIO;
  const signSize = size * SIGN_SIZE_RATIO;
  const signT = size * SIGN_THICKNESS_RATIO;
  const chevronW = size * CHEVRON_WIDTH_RATIO;

  ctx.save();
  ctx.translate(x, y);

  // Set once, used by both "|" and "⟩" below, so they share one line
  // weight by construction rather than by two ratio constants happening to
  // agree.
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = lineT;
  //ctx.lineCap = 'round';
  //ctx.lineJoin = 'round';

  // "|" -- stroked, not filled, to match the chevron's line weight exactly.
  ctx.beginPath();
  ctx.moveTo(lineT / 2, -size / 2);
  ctx.lineTo(lineT / 2, size / 2);
  ctx.stroke();
  let cursor = lineT + gap;

  // "+" or "-", vertically centered on y=0
  ctx.fillRect(cursor, -signT / 2, signSize, signT);
  if (sign === '+') {
    ctx.fillRect(cursor + signSize / 2 - signT / 2, -signSize / 2, signT, signSize);
  }
  cursor += signSize + 0.50*gap;

  // "⟩" -- same stroke settings as "|" above.
  ctx.beginPath();
  ctx.moveTo(cursor, -size / 2);
  ctx.lineTo(cursor + chevronW, 0);
  ctx.lineTo(cursor, size / 2);
  ctx.stroke();

  ctx.restore();
}