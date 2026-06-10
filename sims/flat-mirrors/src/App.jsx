import React, { useState } from 'react';
import './App.css';
import Panel1 from './panels/Panel1';
import Panel2 from './panels/Panel2';
import Panel3 from './panels/Panel3';

export default function App() {
  const [activePanel, setActivePanel] = useState(1);
  
  // Panel 1 state
  const [gridOn, setGridOn] = useState(true);
  const [measuringMode, setMeasuringMode] = useState(false);
  const [normalView, setNormalView] = useState(false);
  const [showVirtualImage, setShowVirtualImage] = useState(true);
  // 0 = no angles shown, 1 = angles shown
  const [anglesView, setAnglesView] = useState(0);
  const [mirrorAngle, setMirrorAngle] = useState(0);
  // Measurement coordinates and viewing
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [measurementCoords, setMeasurementCoords] = useState([]);

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        {activePanel === 1 && <Panel1 gridOn={gridOn} mirrorAngle={mirrorAngle} measuringMode={measuringMode} normalView={normalView} anglesView={anglesView} measurementCoords={measurementCoords} setMeasurementCoords={setMeasurementCoords} showMeasurements={showMeasurements} showVirtualImage={showVirtualImage} />}
        {activePanel === 2 && <Panel2 gridOn={gridOn} />}
        {activePanel === 3 && <Panel3 gridOn={gridOn} />}
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
                <h3>Instructions</h3>
                <p>Drag the object or eye around and watch if and when a virtual image is visible.</p>

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
                  <button className={`control-button ${normalView ? 'active' : ''}`} onClick={() => setNormalView(!normalView)}>
                    {normalView ? 'Hide mirror normal' : 'Show mirror normal'}
                  </button>
                </div>
                <div className="control-group">
                  <button className={`control-button ${anglesView ? 'active' : ''}`} onClick={() => setAnglesView(!anglesView)} disabled={!normalView}>
                    {anglesView ? 'Hide incident and reflected angles' : 'Show incident and reflected angles'}
                  </button>
                </div>

                <div className="control-group" style={{ marginTop: '1.0em' }}>
                  <button className={`control-button ${measuringMode ? 'active-special' : ''}`} onClick={() => setMeasuringMode(!measuringMode)}>
                    {measuringMode ? 'Disable measuring mode' : 'Enable measuring mode'}
                  </button>
                </div>
                <div className="control-group" style={{ flexDirection: 'row' }}>
                  <button className={`control-button ${showMeasurements ? 'active' : ''}`} onClick={() => setShowMeasurements(!showMeasurements)}>
                    {showMeasurements ? 'Hide measurements' : 'Show measurements'}
                  </button>
                  <button className="control-button" onClick={() => setMeasurementCoords([])}>
                    Clear measurements
                  </button>
                </div>

                <div className="control-group" style={{ marginTop: '1.0em' }}>
                  <button className={`control-button ${showVirtualImage ? 'active' : ''}`} onClick={() => setShowVirtualImage(!showVirtualImage)}>
                    {showVirtualImage ? 'Hide virtual image' : 'Show virtual image'}
                  </button>
                </div>
                <div className="control-group">
                  <button className={`control-button ${gridOn ? 'active' : ''}`} onClick={() => setGridOn(!gridOn)}>
                    {gridOn ? 'Hide grid' : 'Show grid'}
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
                    <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} />
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
                    <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} />
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