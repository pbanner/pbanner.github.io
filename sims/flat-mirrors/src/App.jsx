import React, { useState } from 'react';
import './App.css';
import Panel1 from './panels/Panel1';
import Panel2 from './panels/Panel2';
import Panel3 from './panels/Panel3';

export default function App() {
  const [activePanel, setActivePanel] = useState(1);
  
  // Panel 1 state
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,             // Displaying the grid
    normalView: false,        // Displaying the mirror normal line
    showVirtualImage: true,   // Displaying the virtual image and ray tracebacks
    showAddlRays: false,      // Displaying additional rays from the object
    anglesView: false,        // Displaying the incident and reflected angles, arcs and values; old: // 0 = no angles shown, 1 = angles shown
    showMeasurements: true    // Show measurements made by user

  });
  const [measuringMode, setMeasuringMode] = useState(false);  
  // Mirror angle can be rotated by a UI slider
  const [mirrorAngle, setMirrorAngle] = useState(0);
  // Measurement coordinates
  const [measurementCoords, setMeasurementCoords] = useState([]);

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        {activePanel === 1 && <Panel1 mirrorAngle={mirrorAngle} measuringMode={measuringMode} measurementCoords={measurementCoords} setMeasurementCoords={setMeasurementCoords} displayBools={displayBools} />}
        {activePanel === 2 && <Panel2 displayBools={displayBools} />}
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
                Panel 1: Point Object
              </button>
              <button 
                className={`nav-button ${activePanel === 2 ? 'active' : ''}`}
                onClick={() => setActivePanel(2)}
              >
                Panel 2: Extended Object
              </button>
              <button 
                className={`nav-button ${activePanel === 3 ? 'active' : ''}`}
                onClick={() => setActivePanel(3)}
              >
                Panel 3: Playground
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

                <div className="control-group" style={{ marginTop: '1.0em', marginBottom: '1.5em' }}>
                  <label style={{ justifyContent: 'center' }}>Mirror angle: {(mirrorAngle * 180 / Math.PI).toFixed(1)}°</label>
                  <input
                    type="range"
                    min={-Math.PI}
                    max={Math.PI}
                    step="0.01"
                    value={mirrorAngle}
                    onChange={(e) => setMirrorAngle(parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="control-group" style={{ marginTop: '1.0em' }}>
                  <button className={`control-button ${displayBools.normalView ? 'active' : ''}`} onClick={() => setDisplayBools({ ...displayBools, normalView: !displayBools.normalView })}>
                    {displayBools.normalView ? 'Hide mirror normal' : 'Show mirror normal'}
                  </button>
                </div>
                <div className="control-group">
                  <button className={`control-button ${displayBools.anglesView ? 'active' : ''}`} onClick={() => setDisplayBools({ ...displayBools, anglesView: !displayBools.anglesView })} disabled={!displayBools.normalView}>
                    {displayBools.anglesView ? 'Hide incident and reflected angles' : 'Show incident and reflected angles'}
                  </button>
                </div>

                <div className="control-group" style={{ marginTop: '1.0em' }}>
                  <button className={`control-button ${measuringMode ? 'active-special' : ''}`} onClick={() => setMeasuringMode(!measuringMode)}>
                    {measuringMode ? 'Disable measuring mode' : 'Enable measuring mode'}
                  </button>
                </div>
                <div className="control-group" style={{ flexDirection: 'row' }}>
                  <button className={`control-button ${displayBools.showMeasurements ? 'active' : ''}`} onClick={() => setDisplayBools({ ...displayBools, showMeasurements: !displayBools.showMeasurements })}>
                    {displayBools.showMeasurements ? 'Hide measurements' : 'Show measurements'}
                  </button>
                  <button className="control-button" onClick={() => setMeasurementCoords([])}>
                    Clear measurements
                  </button>
                </div>
                <p style={{ marginTop: '0.5em' }}><b>Measurement mode instructions: </b>
                If this mode is enabled, press down and drag to make a measurement.
                Hold Shift before or during measurement to snap the measuring tool to nearby objects or previous measurement points.
                While dragging, you can use Escape to stop the current measurement.
                Use Backspace to delete measurements.</p>

                <div className="control-group" style={{ marginTop: '1.0em' }}>
                  <button className={`control-button ${displayBools.showAddlRays ? 'active' : ''}`} onClick={() => setDisplayBools({ ...displayBools, showAddlRays: !displayBools.showAddlRays })}>
                    {displayBools.showAddlRays ? 'Hide additional rays' : 'Show additional rays'}
                  </button>
                </div>
                <div className="control-group" style={{ marginTop: '1.0em' }}>
                  <button className={`control-button ${displayBools.showVirtualImage ? 'active' : ''}`} onClick={() => setDisplayBools({ ...displayBools, showVirtualImage: !displayBools.showVirtualImage })}>
                    {displayBools.showVirtualImage ? 'Hide virtual image' : 'Show virtual image'}
                  </button>
                </div>
                <div className="control-group">
                  <button className={`control-button ${displayBools.gridOn ? 'active' : ''}`} onClick={() => setDisplayBools({ ...displayBools, gridOn: !displayBools.gridOn })}>
                    {displayBools.gridOn ? 'Hide grid' : 'Show grid'}
                  </button>
                </div>
              </div>
            )}
            {activePanel === 2 && (
              <div>
                <h3>Panel 2 Controls</h3>
                <p>Instructions and controls will appear here.</p>
                <div className="control-group">
                  <label>
                    <input type="checkbox" checked={displayBools.gridOn} onChange={(e) => setDisplayBools({ ...displayBools, gridOn: e.target.checked })} />
                    Show grid
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