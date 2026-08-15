// Small presentational controls shared across the overlay panels -- kept in
// their own module (mirroring the Stern-Gerlach sim's controls.jsx) so any
// panel can reuse them without the panels importing each other's internals.

// `vertical` swaps the default label-above-(slider+textbox side by side)
// layout for label-above-slider-above-textbox, with the slider itself
// running top-to-bottom over `verticalLength` px (see .vertical-range-wrap
// in App.css for how a plain <input type="range"> becomes vertical --
// there's no native vertical variant, so it's a rotated horizontal one).
// Everything else about the control -- including the plain horizontal
// layout when `vertical` is left false -- is unchanged.
export function SliderPlusTextboxControl({ label, valueNum, onChangeNum, min, max, step, disabled = false, vertical = false, verticalLength = 140 }) {
  const range = (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={valueNum}
      onChange={(e) => onChangeNum(parseFloat(e.target.value))}
      style={vertical ? { width: verticalLength } : { flex: 1 }}
      disabled={disabled}
    />
  );
  const textbox = (
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
      style={{ width: '55px', padding: '2px' }}
      disabled={disabled}
    />
  );

  if (vertical) {
    return (
      <div className="control-group control-group-vertical">
        <label style={{ fontSize: '14px' }}>{label}</label>
        <div className="vertical-range-wrap" style={{ height: verticalLength }}>{range}</div>
        {textbox}
      </div>
    );
  }

  return (
    <div className="control-group">
      <label style={{ margin: '0em 0em -0.5em 0', fontSize: '14px' }}>{label}</label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {range}
        {textbox}
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
