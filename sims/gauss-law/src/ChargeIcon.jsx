// Flat 2D picture of a charge: a shaded disc with a white + or − on it.
// Used for the sidebar buttons and for the placement ghost while it's off
// the floor grid (once it's over the grid, the 3D ghost in the scene takes
// over). Drawn as inline SVG rather than a PNG asset so the color always
// matches chargeTypes.js.
export default function ChargeIcon({ type, size = 32 }) {
  const gradientId = `charge-icon-gradient-${type.id}`;
  const isPositive = type.q > 0;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <radialGradient id={gradientId} cx="38%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="45%" stopColor={type.color} stopOpacity="1" />
          <stop offset="100%" stopColor={type.color} stopOpacity="1" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill={`url(#${gradientId})`} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      <rect x="9" y="14.5" width="14" height="3" rx="1" fill="white" />
      {isPositive && <rect x="14.5" y="9" width="3" height="14" rx="1" fill="white" />}
    </svg>
  );
}
