import React, { useState } from 'react';
import './App.css';
import LabPanel from './LabPanel';
import sgImage from './assets/SG.png';
import pcImage from './assets/PC.png';

// Unicode glyphs (▶ ⏸ ⌂) bake their own, font-dependent vertical padding
// into the glyph box, so flexbox centering lines up the boxes but not the
// visible ink — hence the icon-vs-text misalignment. Drawing the icons
// ourselves as SVG paths sidesteps that: there's no hidden glyph metrics,
// so `alignItems: 'center'` centers exactly what's visible.
function PlayIcon({ size = '0.9em' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M4 2l10 6-10 6z" />
    </svg>
  );
}

function PauseIcon({ size = '0.9em' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="3" y="2" width="4" height="12" />
      <rect x="9" y="2" width="4" height="12" />
    </svg>
  );
}

const SG_OPTION_LABELS = ['X', 'Y', 'Z'];
const SG_OPTION_BASES = [[Math.PI/2, 0], [Math.PI/2, Math.PI/2], [0,0]];
function AxisStepper(numid, experiment, setExperiment) {
  const [index, setIndex] = useState(2); // start on 'Z'

  const step = (delta) => {
    setIndex((i) => (i + delta + SG_OPTION_LABELS.length) % SG_OPTION_LABELS.length);
    // setExperiment call here
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: '10px', padding: '6px' }}>
      <input type="checkbox" />
      <label>{'SG' + numid}</label>
      <div className="axis-stepper">
        <span className="axis-stepper-value">{SG_OPTION_LABELS[index]}</span>
        <div className="axis-stepper-arrows">
          <button type="button" className="axis-stepper-arrow" onClick={() => step(1)} aria-label="Next axis">▲</button>
          <button type="button" className="axis-stepper-arrow" onClick={() => step(-1)} aria-label="Previous axis">▼</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {  
  // Panel 1 state
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,             // Displaying the grid
  });
  // The experimental setup is coded as a list of present SG setups; each
  // setup has a measurement basis plus a statement about where its up and down
  // outputs are going
  // Start with one apparatus already in place
  const [experiment, setExperiment] = useState([{ basis: [0, 0], up: null, down: null }]);

  const addSternGerlach = () => {
    setExperiment((prev) => [
      ...prev,
      { basis: [0, 0], up: null, down: null },
    ]);
  };

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        <LabPanel experiment={experiment} setExperiment={setExperiment} displayBools={displayBools} />
      </div>

      {/* Right Sidebar */}
      <aside className="control-bar">
        <div className="control-bar-content">
          {/* Build Experiment Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Build Experiment</h3>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
              <div style={{display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button type="button" className="control-bar-button icon-button" aria-label="Add Stern-Gerlach apparatus" onClick={addSternGerlach}>
                  <img src={sgImage} alt="" className="icon-button-image" />
                  <span>Add Stern-Gerlach</span>
                </button>
                <button type="button" className="control-bar-button icon-button" aria-label="Add particle counter">
                  <img src={pcImage} alt="" className="icon-button-image" />
                  <span>Add Particle Counter</span>
                </button>
              </div>
              <div style={{display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button type="button" className="control-bar-button icon-button" aria-label="Add Stern-Gerlach apparatus">
                  <img src={sgImage} alt="" className="icon-button-image" />
                  <span>Add Beam Block</span>
                </button>
              </div>
            </div>
          </div>
          {/* Set Measurement Basis Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Set Measurement Bases</h3>
            <AxisStepper numid={1} />
          </div>
          {/* Data Collection Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Data Collection Controls</h3>
            <div style = {{ padding: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label><input type="radio" name="DCmode" value="one" />One particle</label>
              <label><input type="radio" name="DCmode" value="stream" />Particle stream</label>
            </div>
            <button className="control-bar-button" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px'}}>
              <PlayIcon /> {/* <PauseIcon />} */}
              Start
            </button>
            <button className="control-bar-button">
              Reset Data Collection
            </button>
          </div>
          {/* Histogram canvas area */}
          <div className="histogram-panel">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Histogram</h3>
            <div className="histogram-canvas-wrap">
              <canvas />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}