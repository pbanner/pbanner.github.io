import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import LabPanel from './LabPanel';
import Histogram from './Histogram';
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

function StopIcon({ size = '0.9em' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="3" y="3" width="10" height="10" />
    </svg>
  );
}

const SG_OPTION_LABELS = ['X', 'Y', 'Z'];
const SG_OPTION_BASES = [[Math.PI/2, 0], [Math.PI/2, Math.PI/2], [0, 0]];

function AxisStepper({ index, sg, setExperiment, disabled, resetDataCollection }) {
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
    resetDataCollection(); // a basis change is a setup change -- old counts no longer apply
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: '10px', padding: '6px' }}>
      <input type="checkbox" disabled={disabled} />
      <label>{'SG' + (index + 1)}</label>
      <div className="axis-stepper">
        <span className={`axis-stepper-value ${disabled ? 'disabled' : ''}`}>
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

function SliderPlusTextboxControl({ label, valueNum, onChangeNum, min, max, step, disabled = false }) {
  return (
    <div className="control-group">
      <label style={{ margin: '-0.25em 0em' }}>{label}</label> {/*: {valueNum.toFixed(1)}*/}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueNum}
          onChange={(e) => onChangeNum(parseFloat(e.target.value))}
          style={{ flex: 1 }}
          disabled={disabled}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={valueNum}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChangeNum(v);
          }}
          style={{ width: '70px', padding: '2px' }}
          disabled={disabled}
        />
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
  const [histDisplayBools, setHistDisplayBools] = useState({
    showPercentages: 2,    // 0 = counts only, 1 = percentages only, 2 = both
    showTheory: false,
    showLegend: true,
    showTotal: true,
    showErrorBars: false
  });
  // build = 0 for normal operation, 1 for placing a particle counter, 2 for placing
  // a beam block, -1 for deleting stuff
  // running = true or false
  // rate = number of particles per second
  // dc (for data collection) may be 'single' or 'stream'
  const [expMode, setExpMode] = useState({ build: 0, dc: 'single', running: false, rate: 20 })
  // The experimental setup is coded as a list of present SG setups; each
  // setup has a measurement basis plus a statement about where its up and down
  // outputs are going
  // up and down may be null, `bb`, or { type: 'pc', data: [integer], colorId: string }
  // Start with one apparatus already in place
  const [experiment, setExperiment] = useState([{ basis: [0, 0], up: null, down: null }]);

  // For getting tab visibility and pausing animation as appropriate
  // Tracks whether this tab is the active one, so both particle production
  // (below) and the animation itself (inside LabPanel) can pause together
  // while it's hidden, rather than each drifting out of sync with the
  // other based on whatever throttling the browser happens to apply to
  // timers and rAF callbacks in background tabs.
  const [tabVisible, setTabVisible] = useState(!document.hidden);
  useEffect(() => {
    const onVisibilityChange = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Particle propagation
  const labPanelRef = useRef(null);
  const [particleCount, setParticleCount] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const streamTimerRef = useRef(null);

  const controlsLocked = particleCount > 0;

  // Any setup change (add/remove an SG, place/remove a PC or BB, change a
  // basis) invalidates whatever's been collected so far -- called
  // explicitly at every site that mutates the experiment's structure,
  // rather than watched via an effect on `experiment` itself, since PC hit
  // counts also live inside `experiment` and a structure-watching effect
  // would zero itself out the instant a particle actually landed.
  const resetDataCollection = () => {
    setResetToken((t) => t + 1);
    setExpMode((prev) => ({ ...prev, running: false }));
    setExperiment((prev) => prev.map((sg) => ({
      ...sg,
      up: sg.up?.type === 'pc' ? { ...sg.up, data: 0 } : sg.up,
      down: sg.down?.type === 'pc' ? { ...sg.down, data: 0 } : sg.down,
    })));
  };

  const addSternGerlach = () => {
    setExperiment((prev) => [
      ...prev,
      { basis: [0, 0], up: null, down: null },
    ]);
    resetDataCollection();
  };

  // Checks the last SG's arms before data collection starts; if either is
  // still open (would let particles fly off unmeasured), confirms with the
  // user, then either plugs the gap with beam blocks or backs out. Returns
  // the up-to-date experiment to spawn against, or null if the user
  // cancelled -- setExperiment is async, so a caller that needs to spawn
  // immediately after this can't just re-read the `experiment` closure.
  const ensureTerminatedThenGetExperiment = () => {
    if (experiment.length === 0) return experiment;

    const lastIndex = experiment.length - 1;
    const lastSG = experiment[lastIndex];
    const openArms = [];
    if (lastSG.up === null) openArms.push('up');
    if (lastSG.down === null) openArms.push('down');
    if (openArms.length === 0) return experiment;

    const plural = openArms.length > 1;
    const message =
      `The ${openArms.join(' and ')} ${plural ? 'paths are' : 'path is'} unterminated on the last ` +
      `Stern-Gerlach apparatus -- particles could fly off without ever being measured.\n\n` +
      `Click OK to place a beam block ${plural ? 'at those locations' : 'there'} and start ` +
      `data collection, or Cancel to go back and place something yourself first.`;
    if (!window.confirm(message)) return null;

    const nextExperiment = experiment.map((sg, i) => (i !== lastIndex ? sg : {
      ...sg,
      up: sg.up === null ? 'bb' : sg.up,
      down: sg.down === null ? 'bb' : sg.down,
    }));
    setExperiment(nextExperiment);
    resetDataCollection();
    return nextExperiment;
  };

  const handleStartPause = () => {
    const startingNow = expMode.dc === 'single' || !expMode.running;
    let experimentToSpawnFrom = experiment;

    if (startingNow) {
      const result = ensureTerminatedThenGetExperiment();
      if (result === null) return; // cancelled -- don't start anything
      experimentToSpawnFrom = result;
    }

    setExpMode((prev) => ({
      ...prev,
      build: 0, // leave any build/delete mode the moment particles start propagating
      running: prev.dc === 'single' ? prev.running : !prev.running,
    }));
    if (expMode.dc === 'single') {
      labPanelRef.current?.spawnParticle(experimentToSpawnFrom);
    }
  };

  useEffect(() => {
    if (expMode.dc === 'stream' && expMode.running && tabVisible) {
      streamTimerRef.current = setInterval(() => {
        labPanelRef.current?.spawnParticle();
      }, 1/expMode.rate*1000);
      return () => clearInterval(streamTimerRef.current);
    }
  }, [expMode.dc, expMode.running, expMode.rate, tabVisible]);

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
          resetDataCollection={resetDataCollection}
          tabVisible={tabVisible}
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
                  <img src={sgImage} alt="" className="icon-button-image" draggable="false" />
                  <span>Add Stern-Gerlach</span>
                </button>
                <button type="button" className={`control-bar-button icon-button ${expMode.build === 1 ? 'active' : ''}`} aria-label="Add particle counter" onMouseDown={() => setExpMode({ ...expMode, build: expMode.build === 1 ? 0 : 1 })} disabled={controlsLocked}>
                  <img src={pcImage} alt="" className="icon-button-image" draggable="false" />
                  <span>Add Particle Counter</span>
                </button>
              </div>
              <div style={{display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button type="button" className={`control-bar-button icon-button ${expMode.build === 2 ? 'active' : ''}`} aria-label="Add beam block" onMouseDown={() => setExpMode({ ...expMode, build: expMode.build === 2 ? 0 : 2 })} disabled={controlsLocked}>
                  <img src={bbImage} alt="" className="icon-button-image" draggable="false" />
                  <span>Add Beam Block</span>
                </button>
                <button type="button" className={`control-bar-button icon-button ${expMode.build === -1 ? 'active' : ''}`} aria-label="Remove components" onClick={() => setExpMode({ ...expMode, build: expMode.build === -1 ? 0 : -1 })} disabled={controlsLocked}>
                  <img src={xImage} alt="" className="icon-button-image" draggable="false" />
                  <span>Remove Components</span>
                </button>
              </div>
            </div>
          </div>
          {/* Set Measurement Basis Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Set Measurement Bases</h3>
            <p style={{ width: '180px' }}>Check the checkbox next to an SG label to set its basis by angles (θ, ϕ).</p>
            {experiment.map((sg, i) => (
            <AxisStepper key={i} index={i} sg={sg} setExperiment={setExperiment} disabled={controlsLocked || (expMode.build !== 0)} resetDataCollection={resetDataCollection} />
            ))}
          </div>
          {/* Data Collection Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Data Collection Controls</h3>
            <div style = {{ padding: '2px', display: 'flex', flexDirection: 'row', gap: '20px' }}>
              <label><input type="radio" name="DCmode" value="single" checked={expMode.dc === 'single'} onChange={(event) => {setExpMode({ ...expMode, dc: event.target.value });}} disabled={expMode.build !== 0} />One at a time</label>
              <label><input type="radio" name="DCmode" value="stream" checked={expMode.dc === 'stream'} onChange={(event) => {setExpMode({ ...expMode, dc: event.target.value });}} disabled={expMode.build !== 0} />Continuous</label>
            </div>
            <label style={{ margin: '4px 0 0 0' }}>
              <input type="checkbox" disabled={expMode.build !== 0} checked={displayBools.previewPaths} onChange={(e) => setDisplayBools({ ...displayBools, previewPaths: e.target.checked })} />
              Preview possible paths
            </label>
            <div className="control-group" style={{ marginTop: '0.5em' }}>
              <SliderPlusTextboxControl
                label="Particle Number"
                valueNum={expMode.rate}
                onChangeNum={(val) => {setExpMode({ ...expMode, rate: val });}}
                min={0.0}
                max={100}
                step={0.1}
                disabled={expMode.build !== 0}
              />
            </div>
            <button className="control-bar-button" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px'}} onClick={handleStartPause} disabled={expMode.build !== 0}>
              {expMode.dc === 'single'
                ? (<><PlayIcon /> Make One Particle</>)
                : expMode.running
                  ? (<><StopIcon /> Stop</>)
                  : (<><PlayIcon /> Start</>)}
            </button>
            <button className="control-bar-button" onClick={resetDataCollection} disabled={expMode.build !== 0}>
              Reset Data Collection
            </button>
          </div>
          {/* Histogram canvas area */}
          <div className="control-bar-group" style={{ flexDirection: 'row', flex: '1 1 auto', gap: '10px', minWidth: '0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h3 style={{ padding: '6px 0px 4px 0px' }}>Chart Options</h3>
              <div style = {{ padding: '2px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label><input type="radio" name="barLabelMode" value={0} disabled={expMode.build !== 0} checked={histDisplayBools.showPercentages === 0} onChange={(event) => {setHistDisplayBools({ ...histDisplayBools, showPercentages: Number(event.target.value) });}} />Counts</label>
                <label><input type="radio" name="barLabelMode" value={1} disabled={expMode.build !== 0} checked={histDisplayBools.showPercentages === 1} onChange={(event) => {setHistDisplayBools({ ...histDisplayBools, showPercentages: Number(event.target.value) });}} />Percentages</label>
                <label><input type="radio" name="barLabelMode" value={2} disabled={expMode.build !== 0} checked={histDisplayBools.showPercentages === 2} onChange={(event) => {setHistDisplayBools({ ...histDisplayBools, showPercentages: Number(event.target.value) });}} />Both</label>
              </div>
              <label style={{ padding: '0px 0 0 0' }}>
                <input type="checkbox" disabled={expMode.build !== 0} checked={histDisplayBools.showErrorBars} onChange={(e) => setHistDisplayBools({ ...histDisplayBools, showErrorBars: e.target.checked })} />
                Show error bars
              </label>
              <label style={{ padding: '0px 0 0 0' }}>
                <input type="checkbox" disabled={expMode.build !== 0} checked={histDisplayBools.showLegend} onChange={(e) => setHistDisplayBools({ ...histDisplayBools, showLegend: e.target.checked })} />
                Show legend
              </label>
              <label style={{ padding: '0px 0 0 0' }}>
                <input type="checkbox" disabled={expMode.build !== 0} checked={histDisplayBools.showTotal} onChange={(e) => setHistDisplayBools({ ...histDisplayBools, showTotal: e.target.checked })} />
                Show running total
              </label>
              <label style={{ padding: '0px 0 0 0' }}>
                <input type="checkbox" disabled={expMode.build !== 0} checked={histDisplayBools.showTheory} onChange={(e) => setHistDisplayBools({ ...histDisplayBools, showTheory: e.target.checked })} />
                Theoretical probabilities
              </label>
            </div>
            <div className="histogram-panel">
              <div className="histogram-canvas-wrap">
                <Histogram experiment={experiment} displayBools={histDisplayBools} />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}