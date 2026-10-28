// The "Display Options" overlay panel in the lower-right corner, styled
// like the optics lab's overlay panels (see .overlay-controls in App.css).
// Purely presentational: the options themselves live in App.jsx's
// displayOptions state.
import { FIELD_LINE_DENSITY_LEVELS } from './fieldLines.js';
import { FIELD_ARROW_DENSITY_LEVELS } from './fieldArrows.js';

// The electric field is shown as field lines or as a grid of arrows, with
// one density slider (1-5) for both: it steps through the field lines'
// starting-direction sets in fieldLines.js (SEED_SETS, 6 to 50 lines per
// charge), or the arrow grids in fieldArrows.js (3 to 11 arrows along each
// axis). The value is shown in the label rather than in a separate number
// box (as the optics lab's SliderPlusTextboxControl does) to keep the panel
// thin. The style choice and the slider are dimmed while the field is
// hidden.
if (FIELD_LINE_DENSITY_LEVELS !== FIELD_ARROW_DENSITY_LEVELS) {
  throw new Error('Field lines and arrows must have the same number of density levels');
}
const FIELD_DENSITY_RANGE = { min: 1, max: FIELD_LINE_DENSITY_LEVELS, step: 1 };

export default function DisplayOptionsPanel({ displayOptions, setDisplayOptions }) {
  const setOption = (key, value) => setDisplayOptions((prev) => ({ ...prev, [key]: value }));
  return (
    <div className="overlay-controls display-options-panel">
      <h3>Display Options</h3>
      <label>
        <input type="checkbox" checked={displayOptions.showGrid} onChange={(e) => setOption('showGrid', e.target.checked)} />
        Grid (xy plane)
      </label>
      <label>
        <input type="checkbox" checked={displayOptions.showAxes} onChange={(e) => setOption('showAxes', e.target.checked)} />
        Axes
      </label>
      <label>
        <input type="checkbox" checked={displayOptions.showField} onChange={(e) => setOption('showField', e.target.checked)} />
        Electric field
      </label>
      <div className={`control-group field-style${displayOptions.showField ? '' : ' disabled'}`}>
        {[['lines', 'Lines'], ['arrows', 'Arrows']].map(([style, label]) => (
          <label key={style}>
            <input
              type="radio"
              name="field-style"
              checked={displayOptions.fieldStyle === style}
              onChange={() => setOption('fieldStyle', style)}
              disabled={!displayOptions.showField}
            />
            {label}
          </label>
        ))}
      </div>
      <div className={`control-group${displayOptions.showField ? '' : ' disabled'}`}>
        <label htmlFor="field-density">Density: {displayOptions.fieldDensity}</label>
        <input
          id="field-density"
          type="range"
          {...FIELD_DENSITY_RANGE}
          value={displayOptions.fieldDensity}
          onChange={(e) => setOption('fieldDensity', Number(e.target.value))}
          disabled={!displayOptions.showField}
        />
      </div>
    </div>
  );
}
