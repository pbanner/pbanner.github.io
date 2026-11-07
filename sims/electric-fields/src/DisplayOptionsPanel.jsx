// The "Display Options" overlay panel in the lower-right corner, styled
// like the optics lab's overlay panels (see .overlay-controls in App.css).
// Purely presentational: the options themselves live in App.jsx's
// displayOptions state.
import { FIELD_LINE_DENSITY_LEVELS } from './fieldLines.js';
import { FIELD_ARROW_DENSITY_LEVELS } from './fieldArrows.js';
import Segmented from './Segmented.jsx';
import { freeLabelText } from './chargeTypes.js';

// The electric field is shown as field lines or as a grid of arrows, with
// one density slider (1-5) for both: it steps through the field lines'
// starting-direction sets in seedDirections.js (6 to 54 lines per unit
// charge), or the arrow grids in fieldArrows.js (3 to 11 arrows along each
// axis). The value is shown in the label rather than in a separate number
// box (as the optics lab's SliderPlusTextboxControl does) to keep the panel
// thin. The style is chosen with joined toggle buttons (Segmented), like
// the properties panel's choices. It and the slider are dimmed, and can't
// be changed, while the field is hidden.
if (FIELD_LINE_DENSITY_LEVELS !== FIELD_ARROW_DENSITY_LEVELS) {
  throw new Error('Field lines and arrows must have the same number of density levels');
}
const FIELD_DENSITY_RANGE = { min: 1, max: FIELD_LINE_DENSITY_LEVELS, step: 1 };

// Which charges' field is drawn, and read by the probes ("Field of"): all
// of them, only the pinned ones, or all but one free charge -- the field
// that free charge feels, chosen from a menu of them. Dimmed, too, while
// there are no free charges, when the three are all the same.
//
// gridPlane: the plane the grid is drawn in, for its label -- 'xy' (the
// floor), or the 2D cut's plane while it's shown. freeCharges: the free
// charges, for the menu. fieldOf / feltBy: the setting in effect (App.jsx
// works it out from displayOptions: there's no choosing a free charge
// that isn't there).
export default function DisplayOptionsPanel({ displayOptions, setDisplayOptions, gridPlane = 'xy', freeCharges = [], fieldOf = 'all', feltBy = null }) {
  const setOption = (key, value) => setDisplayOptions((prev) => ({ ...prev, [key]: value }));
  const canChooseSources = displayOptions.showField && freeCharges.length > 0;
  const chooseSources = (choice) => setDisplayOptions((prev) => ({ ...prev, fieldOf: choice, feltBy: choice === 'felt' ? feltBy ?? freeCharges[0]?.id ?? null : prev.feltBy }));
  return (
    <div className="overlay-controls display-options-panel">
      <h3>Display Options</h3>
      <label>
        <input type="checkbox" checked={displayOptions.showGrid} onChange={(e) => setOption('showGrid', e.target.checked)} />
        Grid ({gridPlane} plane)
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
        <Segmented
          options={[['lines', 'Lines'], ['arrows', 'Arrows']]}
          value={displayOptions.fieldStyle}
          onChange={(style) => setOption('fieldStyle', style)}
          isDisabled={() => !displayOptions.showField}
        />
      </div>
      <div className={`control-group field-of${canChooseSources ? '' : ' disabled'}`}>
        <span>Field of</span>
        <Segmented
          options={[['all', 'All'], ['pinned', 'Pinned'], ['felt', 'Felt by']]}
          value={fieldOf}
          onChange={chooseSources}
          isDisabled={() => !canChooseSources}
        />
        {fieldOf === 'felt' && (
          <select aria-label="Free charge" value={feltBy} disabled={!canChooseSources} onChange={(e) => setOption('feltBy', Number(e.target.value))}>
            {freeCharges.map((c) => (
              <option key={c.id} value={c.id}>{freeLabelText(c.freeLabel)}</option>
            ))}
          </select>
        )}
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
