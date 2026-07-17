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
  });

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        {activePanel === 1 && <Panel1 displayBools={displayBools} />}
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
                Panel 1
              </button>
              <button 
                className={`nav-button ${activePanel === 2 ? 'active' : ''}`}
                onClick={() => setActivePanel(2)}
                disabled={false}
              >
                Panel 2
              </button>
              <button 
                className={`nav-button ${activePanel === 3 ? 'active' : ''}`}
                onClick={() => setActivePanel(3)}
                disabled={false}
              >
                Panel 3
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