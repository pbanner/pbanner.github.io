// Flat 2D picture of something the sidebar places: a shaded disc with a
// white + or − for a point charge, a small drawing of a sphere, rod or
// plane, in the color of its (initially positive) charge, or of a field
// probe (probes.js's PROBE_TYPE). Used for the
// sidebar buttons and for the placement ghost while it's off the floor
// grid (once it's over the grid, the 3D ghost in the scene takes over).
// Drawn as inline SVG rather than PNG assets so the colors always match
// chargeTypes.js.
import { chargeColor } from './chargeTypes.js';

export default function ChargeIcon({ type, size = 32 }) {
  const color = chargeColor(type.kind === 'point' ? type.defaults.q : 1);
  const gradientId = `charge-icon-gradient-${type.id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <radialGradient id={gradientId} cx="38%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="45%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </radialGradient>
      </defs>
      {type.kind === 'point' && (
        <>
          <circle cx="16" cy="16" r="14" fill={`url(#${gradientId})`} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
          <rect x="9" y="14.5" width="14" height="3" rx="1" fill="white" />
          {type.defaults.q > 0 && <rect x="14.5" y="9" width="3" height="14" rx="1" fill="white" />}
        </>
      )}
      {/* A see-through ball with an equator, like the shell drawn in 3D. */}
      {type.kind === 'sphere' && (
        <>
          <circle cx="16" cy="16" r="13" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="1.6" />
          <ellipse cx="16" cy="16" rx="13" ry="4.5" fill="none" stroke={color} strokeWidth="1.2" strokeOpacity="0.8" />
        </>
      )}
      {/* An upright rod, as a new one is placed. */}
      {type.kind === 'rod' && (
        <rect x="12" y="3" width="8" height="26" rx="2" fill={`url(#${gradientId})`} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      )}
      {/* A field probe, as ProbeMarker.jsx draws it: a black ball inside
          three rings -- one seen face on, two edge on. */}
      {type.kind === 'probe' && (
        <g fill="none" stroke="#222" strokeWidth="1.4">
          <circle cx="16" cy="16" r="11" />
          <ellipse cx="16" cy="16" rx="11" ry="4" />
          <ellipse cx="16" cy="16" rx="4" ry="11" />
          <circle cx="16" cy="16" r="5" fill="#151515" stroke="none" />
        </g>
      )}
      {/* A plane seen at an angle: a parallelogram. */}
      {type.kind === 'plane' && (
        <path d="M 9 4 L 25 9 L 25 28 L 9 23 Z" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      )}
    </svg>
  );
}
