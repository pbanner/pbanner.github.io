import React, { useState } from 'react';
import './App.css';
import LabPanel from './LabPanel.jsx';

export default function App() {
  const [activePanel, setActivePanel] = useState(1);
  
  // Panel 1 state
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,             // Displaying the grid
  });

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        <LabPanel displayBools={displayBools} />
      </div>

      {/* Right Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-content">
          {/* Panel-Specific Content */}
          <div className="panel-controls">
            <div>
              <h3>Instructions and Controls</h3>
              <p>Drag the object or eye around and watch if and where a virtual image is visible!
              If desired, right-click in the simulation area to save an image of the current setup.
              Rotate the mirror and explore other controls below!</p>

              <div className="control-group" style={{ marginTop: '1.0em', marginBottom: '1.5em' }}>
                <label style={{ justifyContent: 'center' }}>Mirror angle </label>
                <input
                  type="range"
                  min={-Math.PI}
                  max={Math.PI}
                  step="0.01"
                  //value={mirrorAngle}
                  //onChange={(e) => setMirrorAngle(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="control-group">
                <button className={`control-button ${displayBools.gridOn ? 'active' : ''}`} onClick={() => setDisplayBools({ ...displayBools, gridOn: !displayBools.gridOn })}>
                  {displayBools.gridOn ? 'Hide grid' : 'Show grid'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}