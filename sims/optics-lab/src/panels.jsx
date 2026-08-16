import { useState } from 'react';
import { COMPONENT_TYPES } from './componentTypes.js';
import { PlayIcon, StopIcon, SliderPlusTextboxControl } from './controls.jsx';
import Histogram from './Histogram.jsx';
import trashCanImage from './assets/trash-can.png';

// One icon in the sidebar's single column -- an add-component button, or
// the trash-can delete-mode toggle below them. Reports its own hover in
// and out (as { label, rect } / null) rather than rendering a label itself
// -- the label floats *outside* the (thin) sidebar, so it's App.jsx that
// actually renders it; see onHoverButton and BuildPanel's own doc comment.
// imageScale shrinks just the <img> within the button's own hover/active
// circle (default 1 = fills it, same as every icon but the two
// beamsplitters) -- npbs.png/pbs.png are drawn edge-to-edge in their own
// source canvas, unlike every other icon here which already has some
// built-in margin, so at the same nominal size they're the only two that
// visibly touch the circle.
function SidebarIconButton({ image, label, active, disabled, title, ariaLabel, dataRole, onMouseDown, onClick, onHoverButton, imageScale = 1 }) {
  return (
    <button
      type="button"
      className={`sidebar-icon-button ${active ? 'active' : ''}`}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      data-role={dataRole}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onMouseEnter={(e) => onHoverButton({ label, rect: e.currentTarget.getBoundingClientRect() })}
      onMouseLeave={() => onHoverButton(null)}
    >
      <img
        src={image}
        alt=""
        className="sidebar-icon-button-image"
        draggable="false"
        style={imageScale !== 1 ? { maxWidth: `${imageScale * 100}%`, maxHeight: `${imageScale * 100}%` } : undefined}
      />
    </button>
  );
}

// npbs/pbs get a smaller imageScale than the rest -- see SidebarIconButton's
// own comment on why.
const SIDEBAR_ICON_SCALE = { npbs: 0.75, pbs: 0.75 };

// Left-edge overlay sidebar: place/delete components, Adobe-toolbar style --
// a single thin column of icons, each showing a bold label outside the
// sidebar on hover (see SidebarIconButton/onHoverButton) instead of the
// button growing to fit text. Unlike the Stern-Gerlach sim's build panel,
// there are no measurement bases to set here (that lives elsewhere) and
// there's no fixed set of "legal" placement sites -- any unoccupied grid
// square works, so LabPanel does all of that checking itself once a
// component is armed for placement.
//
// Each add-icon starts its own click-vs-drag gesture on mousedown (see
// App.jsx's handleBuildButtonMouseDown, called here as onButtonMouseDown) --
// a plain click arms click-to-place (unchanged from before: a ghost that
// follows the cursor until a second click drops it), while an actual drag
// drops it wherever the mouse is released, mirroring how an already-placed
// component can be clicked to select or dragged to move. The trash icon
// is simpler: it's not itself draggable, just a click-to-toggle "delete
// mode" button (same as the old "Remove Components" button) -- but it *is*
// a drop target for dragging an already-placed component onto (see
// LabPanel's own drag-release handler, which looks for this button's own
// data-role="trash-target" under the cursor).
//
// Capped at one laser -- see LabPanel's own enforcement of this at the
// actual placement site; this is just what keeps a second one from ever
// getting armed.
export function BuildPanel({ buildMode, onButtonMouseDown, toggleRemoveMode, components, onHoverButton }) {
  const placingId = buildMode?.place ?? null;
  const removing = buildMode === 'remove';
  const hasLaser = components.some((c) => c.type === 'laser');

  return (
    <div className="sidebar-panel">
      <div className="sidebar-heading">Add</div>
      <div className="sidebar-column">
        {COMPONENT_TYPES.map((type) => {
          const disabled = type.id === 'laser' && hasLaser;
          return (
            <SidebarIconButton
              key={type.id}
              image={type.image}
              label={type.label}
              active={placingId === type.id}
              disabled={disabled}
              title={disabled ? 'Only one laser allowed' : undefined}
              ariaLabel={`Add ${type.label}`}
              onMouseDown={(e) => { if (!disabled) onButtonMouseDown(type.id, e); }}
              onHoverButton={onHoverButton}
              imageScale={SIDEBAR_ICON_SCALE[type.id] ?? 1}
            />
          );
        })}
      </div>
      <div className="sidebar-divider" />
      <SidebarIconButton
        image={trashCanImage}
        label="Delete"
        active={removing}
        ariaLabel="Toggle delete mode"
        dataRole="trash-target"
        onClick={toggleRemoveMode}
        onHoverButton={onHoverButton}
      />
    </div>
  );
}

// Middle overlay panel -- controls identical in kind to the Stern-Gerlach
// sim's "Data Collection Controls" group (App.jsx): single-shot vs.
// continuous mode, a Laser Power slider (Continuous mode only), a start/
// stop button, and a reset button. The rate itself still lives on the
// laser component (comp.power) -- App.jsx's continuous-mode timer reads it
// directly -- this is just the other place, alongside the laser's own
// on-canvas selection panel, that can edit it. This panel stays mostly
// presentational: onMakeOnePhoton/onToggleRunning/onResetData/
// onChangeLaserPower are all App.jsx's own handlers/state.
export function DataCollectionPanel({ dcMode, setDcMode, onMakeOnePhoton, onToggleRunning, onResetData, laserPower, onChangeLaserPower }) {
  const hasLaser = laserPower != null;
  return (
    <>
      <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Laser Controls</h3>
      {!hasLaser ? (
        <p style={{ fontSize: '14px', color: '#666' }}>Place a laser to access controls.</p>
      ) : (
        <>
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

          {dcMode.mode === 'stream' && (
            <SliderPlusTextboxControl
              label="Laser Power"
              valueNum={laserPower}
              onChangeNum={onChangeLaserPower}
              min={0.0}
              max={100}
              step={1.0}
            />
          )}

          <div style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}>
            <button
              className="control-bar-button"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flex: '1 1 auto', minWidth: '80px' }}
              onClick={dcMode.mode === 'single' ? onMakeOnePhoton : onToggleRunning}
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
              onClick={onResetData}
            >
              Reset Data
            </button>
          </div>
        </>
      )}
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
