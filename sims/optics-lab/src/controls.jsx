// Small presentational controls shared across the overlay panels -- kept in
// their own module (mirroring the Stern-Gerlach sim's controls.jsx) so any
// panel can reuse them without the panels importing each other's internals.

export function SliderPlusTextboxControl({ label, valueNum, onChangeNum, min, max, step, disabled = false }) {
  return (
    <div className="control-group">
      <label style={{ margin: '-0.25em 0em' }}>{label}</label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueNum}
          onChange={(e) => onChangeNum(parseFloat(e.target.value))}
          style={{ flex: 1 }}
          disabled={disabled}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={valueNum}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChangeNum(v);
          }}
          style={{ width: '70px', padding: '2px' }}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// Unicode glyphs (▶ ⏸ ⏹) bake their own, font-dependent vertical padding
// into the glyph box, so flexbox centering lines up the boxes but not the
// visible ink -- hence drawing these as SVG paths instead (same reasoning
// as the Stern-Gerlach sim's PlayIcon/StopIcon in App.jsx).
export function PlayIcon({ size = '0.9em' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M4 2l10 6-10 6z" />
    </svg>
  );
}

export function StopIcon({ size = '0.9em' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="3" y="3" width="10" height="10" />
    </svg>
  );
}
