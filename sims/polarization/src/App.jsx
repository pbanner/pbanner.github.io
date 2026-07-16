import React, { useState } from 'react';
import './App.css';
import Panel1 from './panels/Panel1';
import Panel2 from './panels/Panel2';
import Panel3 from './panels/Panel3';

const toDeg = (rad) => rad * (180 / Math.PI);
const toRad = (deg) => deg * (Math.PI / 180);

function AngleControl({ label, valueDeg, onChangeDeg, min, max, step }) {
  return (
    <div className="control-group">
      <label style={{ margin: '-0.25em 0em' }}>{label}: {valueDeg.toFixed(1)}°</label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueDeg}
          onChange={(e) => onChangeDeg(parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={valueDeg}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChangeDeg(v);
          }}
          style={{ width: '70px', padding: '2px' }}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [activePanel, setActivePanel] = useState(2);
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,             // Displaying the grid
  });
  const [polState, setPolState] = useState({
    theta: Math.atan(1),           // splits the amplitude between the two field components
    phi: 0 * (Math.PI / 180),     // relative phase between them (V minus H)
  });
  const [panel2displayBools, setPanel2displayBools] = useState({
    animation: true,
    ellipse: false,
    sphere: false,
  });

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        {activePanel === 1 && <Panel1 displayBools={displayBools} />}
        {activePanel === 2 && <Panel2 polState={polState} setPolState={setPolState} panel2displayBools={panel2displayBools} />}
        {activePanel === 3 && <Panel3 displayBools={displayBools} />}
      </div>

      {/* Right Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-content">
          {/* Navigation */}
          <div className="nav-section">
            <h2>Panels</h2>
            <div className="nav-buttons">
              <button 
                className={`nav-button ${activePanel === 1 ? 'active' : ''}`}
                onClick={() => setActivePanel(1)}
              >
                Panel 1: Polarization Measurement
              </button>
              <button 
                className={`nav-button ${activePanel === 2 ? 'active' : ''}`}
                onClick={() => setActivePanel(2)}
              >
                Panel 2: Physics of Polarization
              </button>
              <button 
                className={`nav-button ${activePanel === 3 ? 'active' : ''}`}
                onClick={() => setActivePanel(3)}
              >
                Panel 3: Birefringence
              </button>
            </div>
          </div>

          {/* Divider */}
          <hr className="sidebar-divider" />

          {/* Panel-Specific Content */}
          <div className="panel-controls">
            {activePanel === 1 && (
              <div>
                <h3>Instructions and Controls</h3>
                <p>Drag the object or eye around and watch if and where a virtual image is visible!
                If desired, right-click in the simulation area to save an image of the current setup.
                Rotate the mirror and explore other controls below!</p>
              </div>
            )}
            {activePanel === 2 && (
              <div>
                <h3>Panel 2 Controls</h3>
                <h5 style={{ marginTop: '1.0em' }}>Polarization state:</h5>
                <div className="control-group" style={{ marginTop: '0.5em' }}>
                  <AngleControl
                    label="θ (relative amplitude)"
                    valueDeg={toDeg(polState.theta)}
                    onChangeDeg={(deg) => setPolState((s) => ({ ...s, theta: toRad(deg) }))}
                    min={0}
                    max={90}
                    step={1}
                  />
                  <AngleControl
                    label="φ (relative phase)"
                    valueDeg={toDeg(polState.phi)}
                    onChangeDeg={(deg) => setPolState((s) => ({ ...s, phi: toRad(deg) }))}
                    min={-180}
                    max={180}
                    step={1}
                  />
                </div>
                <div className="control-group" style={{ marginTop: '1.0em', gap: '0px' }}>
                  <h5>Change what is visible:</h5>
                  <label>
                    <input type="checkbox" checked={panel2displayBools.animation} onChange={(e) => setPanel2displayBools({ ...panel2displayBools, animation: e.target.checked })} />
                    Show animation &amp; controls
                  </label>
                  <label>
                    <input type="checkbox" checked={panel2displayBools.ellipse} onChange={(e) => setPanel2displayBools({ ...panel2displayBools, ellipse: e.target.checked })} />
                    Show polarization ellipse
                  </label>
                  <label>
                    <input type="checkbox" checked={panel2displayBools.sphere} onChange={(e) => setPanel2displayBools({ ...panel2displayBools, sphere: e.target.checked })} />
                    Show Poincaré sphere
                  </label>
                </div>
              </div>
            )}
            {activePanel === 3 && (
              <div>
                <h3>Panel 3 Controls</h3>
                <p>Instructions and controls will appear here.</p>
                <div className="control-group">
                  <label>
                    <input type="checkbox" checked={displayBools.gridOn} onChange={(e) => setDisplayBools({ ...displayBools, gridOn: e.target.checked })} />
                    Show grid
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}