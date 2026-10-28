// The "Display Options" overlay panel in the lower-right corner, styled
// like the optics lab's overlay panels (see .overlay-controls in App.css).
// Purely presentational: the options themselves live in App.jsx's
// displayOptions state.
//
// The field line density slider isn't wired to anything yet; it's here
// ahead of the field lines themselves. Its value is shown in the label
// rather than in a separate number box (as the optics lab's
// SliderPlusTextboxControl does) to keep the panel thin.
const FIELD_LINE_DENSITY_RANGE = { min: 1, max: 10, step: 1 };

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
      <div className="control-group">
        <label htmlFor="field-line-density">Field line density: {displayOptions.fieldLineDensity}</label>
        <input
          id="field-line-density"
          type="range"
          {...FIELD_LINE_DENSITY_RANGE}
          value={displayOptions.fieldLineDensity}
          onChange={(e) => setOption('fieldLineDensity', Number(e.target.value))}
        />
      </div>
    </div>
  );
}
