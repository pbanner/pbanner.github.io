import { useState } from 'react';
import { COMPONENT_TYPES } from './componentTypes.js';
import { PlayIcon, StopIcon } from './controls.jsx';
import Histogram from './Histogram.jsx';

// One icon-only button in the Build panel's component row, plus the space
// above it (in BuildPanel) where its hover label appears -- same pattern as
// AddComponentButton in the Stern-Gerlach sim's App.jsx.
function ComponentButton({ type, active, disabled, title, onClick, onMouseEnter, onMouseLeave }) {
  return (
    <button
      type="button"
      className={`control-bar-button icon-only-button icon-only-button-square ${active ? 'active' : ''}`}
      aria-label={`Add ${type.label}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <img src={type.image} alt="" className="icon-only-button-image" draggable="false" />
    </button>
  );
}

// Top overlay panel: place/remove components. Unlike the Stern-Gerlach
// sim's build panel, there are no measurement bases to set here (that'll
// live elsewhere) and there's no fixed set of "legal" placement sites --
// any unoccupied grid square works, so LabPanel does all of that checking
// itself once a component is armed for placement.
// Capped at one laser -- see LabPanel's own enforcement of this at
// the actual placement site; this is just what keeps a second one from
// ever getting armed.
export function BuildPanel({ buildMode, armPlacement, toggleRemoveMode, components }) {
  const [hovered, setHovered] = useState(null);
  const placingId = buildMode?.place ?? null;
  const removing = buildMode === 'remove';
  const hasLaser = components.some((c) => c.type === 'laser');

  return (
    <>
      <h3 style={{ margin: '0 0 0px 0', fontWeight: 'bold' }}>Build Experiment</h3>

      <p className="add-component-heading">
        {'Add: ' + (COMPONENT_TYPES.find((c) => c.id === hovered)?.label ?? '')}
      </p>
      <div className="add-component-row">
        {COMPONENT_TYPES.map((type) => {
          const disabled = type.id === 'laser' && hasLaser;
          return (
            <ComponentButton
              key={type.id}
              type={type}
              active={placingId === type.id}
              disabled={disabled}
              title={disabled ? 'Only one laser allowed' : undefined}
              onMouseEnter={() => setHovered(type.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => armPlacement(type.id, e)}
            />
          );
        })}
      </div>

      <button
        type="button"
        className={`control-bar-button ${removing ? 'active-special' : ''}`}
        aria-label="Remove components"
        onClick={toggleRemoveMode}
      >
        Remove Components
      </button>
    </>
  );
}

// Middle overlay panel -- controls identical in kind to the Stern-Gerlach
// sim's "Data Collection Controls" group (App.jsx): single-shot vs.
// continuous mode, a rate slider, a start/stop button, and a reset button.
// Inert for now -- dcMode.running just toggles the button's own label.
export function DataCollectionPanel({ dcMode, setDcMode }) {
  return (
    <>
      <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Data Collection Controls</h3>
      <div style={{ display: 'flex', flexDirection: 'row', gap: '10px', alignItems: 'center' }}>
        <p style={{ fontSize: '14px', fontWeight: '500' }}>Mode:</p>
        <div style={{ padding: '0px 0px 8px 0px', display: 'flex', flexDirection: 'column', gap: '0px' }}>
          <label>
            <input
              type="radio"
              name="opticsDCmode"
              checked={dcMode.mode === 'single'}
              onChange={() => setDcMode({ ...dcMode, mode: 'single' })}
            />
            One at a time
          </label>
          <label>
            <input
              type="radio"
              name="opticsDCmode"
              checked={dcMode.mode === 'stream'}
              onChange={() => setDcMode({ ...dcMode, mode: 'stream' })}
            />
            Continuous
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}>
        <button
          className="control-bar-button"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flex: '1 1 auto', minWidth: '80px' }}
          onClick={() => setDcMode({ ...dcMode, running: dcMode.mode === 'single' ? dcMode.running : !dcMode.running })}
        >
          {dcMode.mode === 'single'
            ? (<><PlayIcon /> Make One Photon</>)
            : dcMode.running
              ? (<><StopIcon /> Stop</>)
              : (<><PlayIcon /> Start</>)}
        </button>
        <button
          className="control-bar-button"
          style={{ flex: '1 1 auto', minWidth: '80px' }}
          onClick={() => setDcMode({ ...dcMode, running: false })}
        >
          Reset Data
        </button>
      </div>
    </>
  );
}

// Bottom overlay panel -- controls identical in kind to the Stern-Gerlach
// sim's "Chart Options" group, plus the Histogram itself (ported from that
// sim -- see Histogram.jsx for what's different: no SG/arm grouping or
// theory line, since there's nothing here yet to group detectors by or
// compute a theoretical prediction from). The options column can be
// collapsed to give the chart itself more room -- see optionsCollapsed
// below and Histogram's own "«" toggle, shown only while collapsed.
export function DataPlottingPanel({ chartDisplayBools, setChartDisplayBools, components, hoverEnabled, hoveredDetectorId, setHoveredDetectorId }) {
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);

  return (
    <div className={`overlay-controls data-plotting-panel${optionsCollapsed ? ' options-collapsed' : ''}`}>
      <div className="data-plotting-row">
        {!optionsCollapsed && (
          <div className="data-plotting-options">
            <h3 style={{ margin: '0 0 12px 0', fontWeight: 'bold' }}>Chart Options</h3>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', alignItems: 'center', margin: '0 0 10px 0' }}>
              <p style={{ padding: '0px 4px 0 0', fontSize: '14px', fontWeight: '500' }}>Show:</p>
              <div style={{ padding: '0px', display: 'flex', flexDirection: 'column', gap: '0px' }}>
                <label>
                  <input
                    type="radio"
                    name="opticsBarLabelMode"
                    checked={chartDisplayBools.showPercentages === 0}
                    onChange={() => setChartDisplayBools({ ...chartDisplayBools, showPercentages: 0 })}
                  />
                  Counts
                </label>
                <label>
                  <input
                    type="radio"
                    name="opticsBarLabelMode"
                    checked={chartDisplayBools.showPercentages === 1}
                    onChange={() => setChartDisplayBools({ ...chartDisplayBools, showPercentages: 1 })}
                  />
                  Percentages
                </label>
                <label>
                  <input
                    type="radio"
                    name="opticsBarLabelMode"
                    checked={chartDisplayBools.showPercentages === 2}
                    onChange={() => setChartDisplayBools({ ...chartDisplayBools, showPercentages: 2 })}
                  />
                  Both
                </label>
              </div>
            </div>

            <label>
              <input type="checkbox" checked={chartDisplayBools.showErrorBars} onChange={(e) => setChartDisplayBools({ ...chartDisplayBools, showErrorBars: e.target.checked })} />
              Show error bars
            </label>
            <label>
              <input type="checkbox" checked={chartDisplayBools.showLegend} onChange={(e) => setChartDisplayBools({ ...chartDisplayBools, showLegend: e.target.checked })} />
              Show legend
            </label>
            <label>
              <input type="checkbox" checked={chartDisplayBools.showTotal} onChange={(e) => setChartDisplayBools({ ...chartDisplayBools, showTotal: e.target.checked })} />
              Show running total
            </label>
            <label>
              <input type="checkbox" checked={chartDisplayBools.showTheory} onChange={(e) => setChartDisplayBools({ ...chartDisplayBools, showTheory: e.target.checked })} />
              Theoretical probabilities
            </label>

            <button
              type="button"
              className="control-bar-button"
              style={{ marginTop: '10px' }}
              onClick={() => setOptionsCollapsed(true)}
            >
              Hide Options &gt;&gt;
            </button>
          </div>
        )}

        <div className="histogram-panel">
          <div className="histogram-canvas-wrap">
            <Histogram
              components={components}
              displayBools={chartDisplayBools}
              hoverEnabled={hoverEnabled}
              hoveredDetectorId={hoveredDetectorId}
              setHoveredDetectorId={setHoveredDetectorId}
              optionsCollapsed={optionsCollapsed}
              onShowOptions={() => setOptionsCollapsed(false)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
