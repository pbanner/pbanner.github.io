// Hand-drawn "|" and "⟩" brackets around arbitrary inline content -- same
// visual idea as the Bloch sphere sim's own ket.js (a stroked vertical line
// and a stroked chevron, not the Unicode "|"/"⟩" characters, whose vertical
// reach is an inconsistent font-metric detail under normal text rendering
// -- see that file's own comment for the full reasoning). This sim's kets
// need to hold varying content -- two arrows for a two-particle basis state
// like |up-down>, or a Greek letter and sign for a Bell state -- rather
// than that file's single hardcoded +/- sign, so instead of drawing
// pixel-measured content onto a canvas the way its KetIcon does, this draws
// just the two brackets as small SVGs and lets ordinary flexbox lay out
// whatever real DOM content (text, an ArrowIcon, both) sits between them.
function KetBracket({ side, size, color }) {
  const strokeWidth = size * 0.12;
  const chevronReach = size * 0.32;

  if (side === 'left') {
    const w = strokeWidth;
    return (
      <svg width={w} height={size} viewBox={`0 0 ${w} ${size}`} style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
        <line x1={w / 2} y1="0" x2={w / 2} y2={size} stroke={color} strokeWidth={strokeWidth} />
      </svg>
    );
  }

  const w = chevronReach + strokeWidth;
  return (
    <svg width={w} height={size} viewBox={`0 0 ${w} ${size}`} style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
      <polyline
        points={`${strokeWidth / 2},0 ${w - strokeWidth / 2},${size / 2} ${strokeWidth / 2},${size}`}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Ket({ children, size = 16, gap = 3, color = 'currentColor', style }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: `${gap}px`, ...style }}>
      <KetBracket side="left" size={size} color={color} />
      {children}
      <KetBracket side="right" size={size} color={color} />
    </span>
  );
}
