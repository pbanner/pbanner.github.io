import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import LabPanel from './LabPanel';
import sgImage from './assets/SG.png';
import pcImage from './assets/PC.png';
import bbImage from './assets/BB.png';
import xImage from './assets/delete.png';

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
const SG_OPTION_BASES = [[Math.PI/2, 0], [Math.PI/2, Math.PI/2], [0, 0]];

function AxisStepper({ index, sg, setExperiment, disabled }) {
  const currentIndex = SG_OPTION_BASES.findIndex(
    ([theta, phi]) => theta === sg.basis[0] && phi === sg.basis[1]
  );

  const step = (delta) => {
    setExperiment((prev) => {
      const base = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = (base + delta + SG_OPTION_LABELS.length) % SG_OPTION_LABELS.length;
      const next = [...prev];                                  // copy the array
      next[index] = { ...next[index], basis: SG_OPTION_BASES[nextIndex] };  // copy+replace just this entry
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: '10px', padding: '6px' }}>
      <input type="checkbox" disabled={disabled} />
      <label>{'SG' + (index + 1)}</label>
      <div className="axis-stepper">
        <span className="axis-stepper-value">
          {currentIndex === -1 ? '?' : SG_OPTION_LABELS[currentIndex]}
        </span>
        <div className="axis-stepper-arrows">
          <button type="button" className="axis-stepper-arrow" onClick={() => step(1)} aria-label="Next axis" disabled={disabled}>▲</button>
          <button type="button" className="axis-stepper-arrow" onClick={() => step(-1)} aria-label="Previous axis" disabled={disabled}>▼</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {  
  // Panel 1 state
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,             // Displaying the grid
    previewPaths: false       // For previewing particle paths
  });
  // build = 0 for normal operation, 1 for placing a particle counter, 2 for placing
  // a beam block, -1 for deleting stuff
  // running = true or false
  // dc (for data collection) may be 'single' or 'stream'
  const [expMode, setExpMode] = useState({ build: 0, dc: 'single', running: false })
  // The experimental setup is coded as a list of present SG setups; each
  // setup has a measurement basis plus a statement about where its up and down
  // outputs are going
  // up and down may be null, `bb`, or { type: 'pc', data: [integer], colorId: string }
  // Start with one apparatus already in place
  const [experiment, setExperiment] = useState([{ basis: [0, 0], up: null, down: null }]);

  const addSternGerlach = () => {
    setExperiment((prev) => [
      ...prev,
      { basis: [0, 0], up: null, down: null },
    ]);
  };

  // Particle propagation
  const labPanelRef = useRef(null);
  const [particleCount, setParticleCount] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const streamTimerRef = useRef(null);
  const STREAM_SPAWN_INTERVAL_MS = 50;

  const controlsLocked = particleCount > 0;

  const handleStartPause = () => {
    setExpMode((prev) => ({
      ...prev,
      build: 0, // leave any build/delete mode the moment particles start propagating
      running: prev.dc === 'single' ? prev.running : !prev.running,
    }));
    if (expMode.dc === 'single') {
      labPanelRef.current?.spawnParticle();
    }
  };

  useEffect(() => {
    if (expMode.dc === 'stream' && expMode.running) {
      streamTimerRef.current = setInterval(() => {
        labPanelRef.current?.spawnParticle();
      }, STREAM_SPAWN_INTERVAL_MS);
      return () => clearInterval(streamTimerRef.current);
    }
  }, [expMode.dc, expMode.running]);

  const handleReset = () => {
    setResetToken((t) => t + 1);
    setExpMode((prev) => ({ ...prev, running: false }));
    setExperiment((prev) => prev.map((sg) => ({
      ...sg,
      up: sg.up?.type === 'pc' ? { ...sg.up, data: 0 } : sg.up,
      down: sg.down?.type === 'pc' ? { ...sg.down, data: 0 } : sg.down,
    })));
  };

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        <LabPanel
          ref={labPanelRef}
          experiment={experiment}
          setExperiment={setExperiment}
          expMode={expMode}
          setExpMode={setExpMode}
          displayBools={displayBools}
          setParticleCount={setParticleCount}
          resetToken={resetToken}
        />
      </div>

      {/* Right Sidebar */}
      <aside className="control-bar">
        <div className="control-bar-content">
          {/* Build Experiment Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Build Experiment</h3>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
              <div style={{display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button type="button" className="control-bar-button icon-button" aria-label="Add Stern-Gerlach apparatus" onClick={addSternGerlach} disabled={controlsLocked}>
                  <img src={sgImage} alt="" className="icon-button-image" />
                  <span>Add Stern-Gerlach</span>
                </button>
                <button type="button" className={`control-bar-button icon-button ${expMode.build === 1 ? 'active' : ''}`} aria-label="Add particle counter" onClick={() => setExpMode({ ...expMode, build: expMode.build === 1 ? 0 : 1 })} disabled={controlsLocked}>
                  <img src={pcImage} alt="" className="icon-button-image" />
                  <span>Add Particle Counter</span>
                </button>
              </div>
              <div style={{display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button type="button" className={`control-bar-button icon-button ${expMode.build === 2 ? 'active' : ''}`} aria-label="Add beam block" onClick={() => setExpMode({ ...expMode, build: expMode.build === 2 ? 0 : 2 })} disabled={controlsLocked}>
                  <img src={bbImage} alt="" className="icon-button-image" />
                  <span>Add Beam Block</span>
                </button>
                <button type="button" className={`control-bar-button icon-button ${expMode.build === -1 ? 'active' : ''}`} aria-label="Remove components" onClick={() => setExpMode({ ...expMode, build: expMode.build === -1 ? 0 : -1 })} disabled={controlsLocked}>
                  <img src={xImage} alt="" className="icon-button-image" />
                  <span>Remove Components</span>
                </button>
              </div>
            </div>
          </div>
          {/* Set Measurement Basis Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Set Measurement Bases</h3>
            {experiment.map((sg, i) => (
            <AxisStepper key={i} index={i} sg={sg} setExperiment={setExperiment} disabled={controlsLocked} />
            ))}
          </div>
          {/* Data Collection Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Data Collection Controls</h3>
            <div style = {{ padding: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label><input type="radio" name="DCmode" value="single" checked={expMode.dc === 'single'} onChange={(event) => {setExpMode({ ...expMode, dc: event.target.value });}} />One particle</label>
              <label><input type="radio" name="DCmode" value="stream" checked={expMode.dc === 'stream'} onChange={(event) => {setExpMode({ ...expMode, dc: event.target.value });}} />Particle stream</label>
            </div>
            <label style={{ margin: '6px 0 0 0' }}>
              <input type="checkbox" checked={displayBools.previewPaths} onChange={(e) => setDisplayBools({ ...displayBools, previewPaths: e.target.checked })} />
              Preview possible paths
            </label>
            <button className="control-bar-button" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px'}} onClick={handleStartPause}>
              {expMode.dc === 'single'
                ? (<><PlayIcon /> Make One Particle</>)
                : expMode.running
                  ? (<><PauseIcon /> Pause</>)
                  : (<><PlayIcon /> Start</>)}
            </button>
            <button className="control-bar-button" style={{ margin: '6px 0 0 0' }} onClick={handleReset}>
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