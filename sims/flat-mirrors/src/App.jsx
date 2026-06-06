import React, { useState } from 'react';
import './App.css';
import Panel1 from './panels/Panel1';
import Panel2 from './panels/Panel2';
import Panel3 from './panels/Panel3';

export default function App() {
  const [activePanel, setActivePanel] = useState(1);
  
  // Panel 1 state
  const [gridOn, setGridOn] = useState(true);
  const [mirrorAngle, setMirrorAngle] = useState(0);

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        {activePanel === 1 && <Panel1 gridOn={gridOn} mirrorAngle={mirrorAngle} setMirrorAngle={setMirrorAngle} />}
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
                <h3>Panel 1: Point Object</h3>
                <div className="control-group">
                  <label>
                    <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} />
                    Show grid
                  </label>
                </div>
                <div className="control-group">
                  <label>Mirror angle: {(mirrorAngle * 180 / Math.PI).toFixed(1)}°</label>
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