import { useState, useRef, useEffect } from 'react';
import './App.css';
import LabPanel from './LabPanel';
import Histogram from './Histogram';
import sgImage from './assets/SG.png';
import pcImage from './assets/PC.png';
import bbImage from './assets/BB.png';

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
// The advanced θ/ϕ controls are degrees-in, degrees-out for the user -- sg.basis
// itself always stays in radians, since that's what every physics function expects.
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
// Rounds for *display only* -- the underlying radians value in sg.basis is
// never touched, so this just hides floating-point noise like
// 59.999999999999996 in the textbox without losing any real precision.
const roundDeg = (d) => Math.round(d * 1000) / 1000;

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

  // `advanced` lives on the SG itself (not local component state) because
  // SGs can be deleted from the middle of the list (LabPanel's "Remove
  // Components" mode), which shifts every later SG's index down -- local
  // state keyed off that same index would silently reattach to whichever
  // SG happens to land on it afterward. Keeping it on the SG object means
  // it's filtered/reordered right along with the SG it belongs to.
  const setAdvanced = (advanced) => {
    setExperiment((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], advanced };
      return next;
    });
    // Not a basis change -- same angles, just a different way to edit them -- so no resetDataCollection() here.
  };

  const setAngle = (which, value) => {
    setExperiment((prev) => {
      const next = [...prev];
      const [theta, phi] = next[index].basis;
      next[index] = { ...next[index], basis: which === 'theta' ? [value, phi] : [theta, value] };
      return next;
    });
    resetDataCollection();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', padding: '6px' }}>
      <label style={{ fontSize: '14px', fontWeight: '500', marginRight: '5px' }}>{'SG' + (index + 1)}</label>
      {sg.advanced ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ width: '12px' }}>θ</label>
            <input
              type="number"
              min={0}
              max={180}
              step={1}
              value={roundDeg(sg.basis[0] * RAD_TO_DEG)}
              disabled={disabled}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) setAngle('theta', v * DEG_TO_RAD);
              }}
              style={{ width: '70px', padding: '2px' }}
            />
            <span>°</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ width: '12px' }}>ϕ</label>
            <input
              type="number"
              min={0}
              max={360}
              step={1}
              value={roundDeg(sg.basis[1] * RAD_TO_DEG)}
              disabled={disabled}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) setAngle('phi', v * DEG_TO_RAD);
              }}
              style={{ width: '70px', padding: '2px' }}
            />
            <span>°</span>
          </div>
        </div>
      ) : (
        <div className="axis-stepper">
          <span className={`axis-stepper-value ${disabled ? 'disabled' : ''}`}>
            {currentIndex === -1 ? '?' : SG_OPTION_LABELS[currentIndex]}
          </span>
          <div className="axis-stepper-arrows">
            <button type="button" className="axis-stepper-arrow" onClick={() => step(1)} aria-label="Next axis" disabled={disabled}>▲</button>
            <button type="button" className="axis-stepper-arrow" onClick={() => step(-1)} aria-label="Previous axis" disabled={disabled}>▼</button>
          </div>
        </div>
      )}
      {/* marginLeft: auto pins this to the row's right edge regardless of
          whether the stepper or the (differently-sized) theta/phi textboxes
          are showing above, rather than sitting immediately after them. */}
      <button
        type="button"
        className={`control-bar-button advanced-toggle-button ${sg.advanced ? 'active' : ''}`}
        aria-label={`Toggle advanced basis controls for SG${index + 1}`}
        onClick={() => setAdvanced(!sg.advanced)}
        disabled={disabled}
        style={{ marginLeft: 'auto' }}
      >
        {sg.advanced ? 'Set by axis' : 'Set by angles' }
      </button>
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

// One icon-only button in the "Add:" row, plus the space below it (always
// reserved, so hovering never shifts layout) where hoverLabel appears --
// shape picks between a square button (BB, and the inert fourth slot) and
// one just wide enough for its own icon (SG, PC -- both wider than tall).
function AddComponentButton({ image, shape, ariaLabel, hoverLabel, active = false, disabled = false, onClick, onMouseDown }) {
  return (
    <div className="add-component-item">
      <button
        type="button"
        className={`control-bar-button icon-only-button icon-only-button-${shape} ${active ? 'active' : ''}`}
        aria-label={ariaLabel}
        onClick={onClick}
        onMouseDown={onMouseDown}
        disabled={disabled}
      >
        <img src={image} alt="" className="icon-only-button-image" draggable="false" />
      </button>
      <span className="add-component-hover-label">{hoverLabel}</span>
    </div>
  );
}

function SetUpExperimentPanel({ experiment, setExperiment, addSternGerlach, expMode, setExpMode, controlsLocked, displayBools, setDisplayBools, resetDataCollection }) {
  return (
        <>
      {/* Zero-height, purely a width floor -- see .setup-experiment-group
          in App.css for why this (rather than a CSS min-width on the group
          itself) is what keeps the group from ever rendering narrower than
          320px. Negative marginBottom cancels out the group's own 6px flex
          gap, which would otherwise open up a sliver of empty space right
          below this, being the first child. */}
      <div className="setup-experiment-width-floor" style={{ marginBottom: '-6px' }} aria-hidden="true" />
      <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Set Up Experiment</h3>
      <label style={{ margin: '0 0 8px 0' }}>
        <input type="checkbox" disabled={controlsLocked} checked={displayBools.previewPaths} onChange={(e) => setDisplayBools({ ...displayBools, previewPaths: e.target.checked })} />
        Preview possible paths
      </label>

      <div className="add-component-row">
        <span className="add-component-row-label">Add:</span>
        <AddComponentButton
          image={sgImage}
          shape="wide"
          ariaLabel="Add Stern-Gerlach apparatus"
          hoverLabel="Stern-Gerlach"
          onClick={addSternGerlach}
          disabled={controlsLocked}
        />
        <AddComponentButton
          image={pcImage}
          shape="wide"
          ariaLabel="Add particle counter"
          hoverLabel="Particle Counter"
          active={expMode.build === 1}
          onMouseDown={() => setExpMode({ ...expMode, build: expMode.build === 1 ? 0 : 1 })}
          disabled={controlsLocked}
        />
        <AddComponentButton
          image={bbImage}
          shape="square"
          ariaLabel="Add beam block"
          hoverLabel="Beam Block"
          active={expMode.build === 2}
          onMouseDown={() => setExpMode({ ...expMode, build: expMode.build === 2 ? 0 : 2 })}
          disabled={controlsLocked}
        />
        {/* Inert placeholder for a component we haven't built yet -- reuses
            the beam block icon for now purely as a stand-in. 
        <AddComponentButton
          image={bbImage}
          shape="square"
          ariaLabel="Add screen to end of setup"
          hoverLabel="Screen"
          disabled={controlsLocked}
        />
        */}
      </div>

      <button
        type="button"
        className={`control-bar-button ${expMode.build === -1 ? 'active-special' : ''}`}
        aria-label="Remove components"
        onClick={() => setExpMode({ ...expMode, build: expMode.build === -1 ? 0 : -1 })}
        disabled={controlsLocked}
      >
        Remove Components
      </button>

      <SetMeasurementBasesPanel experiment={experiment} setExperiment={setExperiment} controlsLocked={controlsLocked} expMode={expMode} resetDataCollection={resetDataCollection} />
    </>
  );
}

// Pure check for the two ways a start/spawn attempt could go wrong: no SG to
// measure through at all, or the last SG's output isn't fully terminated (a
// PC or BB on both arms) so particles could exit unmeasured. Returns a small
// descriptor for whichever problem applies, or null if the setup's fine to
// start -- doesn't mutate anything itself; App decides what to do with the
// result, and LabPanel turns a non-null one into the on-canvas warning.
function getStartError(experiment) {
  if (experiment.length === 0) return { kind: 'noSG' };

  const lastIndex = experiment.length - 1;
  const lastSG = experiment[lastIndex];
  const openArms = [];
  if (lastSG.up === null) openArms.push('up');
  if (lastSG.down === null) openArms.push('down');
  if (openArms.length === 0) return null;

  return { kind: 'unterminated', sgIndex: lastIndex, openArms };
}
// Given an already-latched start error, checks whether the *same* problem
// is still present -- narrowing it (dropping arms that got terminated) or
// clearing it entirely (dropping it to null), but deliberately never
// escalating to a *different* problem than the one that was actually
// latched. That asymmetry is the point: fixing "no SG at all" by adding one
// SG immediately creates a new "unterminated path" problem on that SG, but
// this must not surface it -- only an actual Start/Make One Particle press
// (getStartError, above) is allowed to report a problem the user hasn't
// been told about yet. Returns the *same* object reference when nothing
// about the error has changed, so callers can compare by reference to
// decide whether a state update is actually needed.
function recheckStartError(error, experiment) {
  if (!error) return null;

  if (error.kind === 'noSG') {
    return experiment.length === 0 ? error : null;
  }

  // 'unterminated' -- keep tracking the same SG only for as long as it's
  // still the last one in the chain (once it isn't, whether it's open or
  // not no longer matters for start-validation), and only for whichever of
  // the originally-flagged arms are still actually open.
  if (error.sgIndex !== experiment.length - 1) return null;
  const sg = experiment[error.sgIndex];
  const stillOpen = error.openArms.filter((arm) => sg[arm] === null);
  if (stillOpen.length === 0) return null;
  return stillOpen.length === error.openArms.length ? error : { ...error, openArms: stillOpen };
}
function SetMeasurementBasesPanel({ experiment, setExperiment, controlsLocked, expMode, resetDataCollection, showHeader = true }) {
  return (
    <>
      {showHeader && <p style={{ margin: '10px 0 0px 0', fontWeight: 'bold', fontSize: '14px', color: '#333' }}>Set Measurement Bases</p>}
      {/* <p style={{ width: '250px' }}>Click Set by Angles/Set by Axis to set an SG's basis by angles (θ, ϕ).</p> */}
      {experiment.map((sg, i) => (
        <AxisStepper key={i} index={i} sg={sg} setExperiment={setExperiment} disabled={controlsLocked || (expMode.build !== 0)} resetDataCollection={resetDataCollection} />
      ))}
    </>
  );
}

export default function App() {  
  // Panel 1 state
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,             // Displaying the grid
    previewPaths: true       // For previewing particle paths
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
  // advanced toggles that SG's basis control between the X/Y/Z stepper and
  // raw theta/phi textboxes -- a display preference, not a physics value
  // Start with one apparatus already in place
  const [experiment, setExperiment] = useState([{ basis: [0, 0], up: 'bb', down: 'bb', advanced: false }]);

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
  
  // Latched only by handleStartPause, when it refuses to start because
  // getStartError found a problem -- LabPanel renders whatever this holds
  // as the on-canvas warning. Every render, recheckStartError narrows or
  // clears it against the live experiment (never escalates it to a
  // *different* problem -- see that function's comment), and if that comes
  // out different from what's currently latched, the state is corrected
  // right here before this render commits. This is the standard React
  // pattern for keeping derived state in sync without an effect: it only
  // fires when the two actually disagree, so it settles in one extra pass
  // rather than looping.
  const [startError, setStartError] = useState(null);
  const liveStartError = recheckStartError(startError, experiment);
  if (liveStartError !== startError) {
    setStartError(liveStartError);
  }

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
      { basis: [0, 0], up: null, down: null, advanced: false },
    ]);
    resetDataCollection();
  };

  const handleStartPause = () => {
    const startingNow = expMode.dc === 'single' || !expMode.running;

    if (startingNow) {
      const error = getStartError(experiment);
      if (error) {
        setStartError(error); // LabPanel shows this on-canvas; user must fix the setup themselves
        return;
      }
      setStartError(null);
    }

    setExpMode((prev) => ({
      ...prev,
      build: 0, // leave any build/delete mode the moment particles start propagating
      running: prev.dc === 'single' ? prev.running : !prev.running,
    }));
    if (expMode.dc === 'single') {
      labPanelRef.current?.spawnParticle();
    }
  };

  // Escape backs out of build/delete mode -- registered once since setExpMode
  // already reads the latest build value itself. Does nothing when already in
  // normal mode.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      setExpMode((prev) => (prev.build === 0 ? prev : { ...prev, build: 0 }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Turns "Preview possible paths" on automatically the moment build/delete
  // mode is entered (build going from 0 to non-zero) -- but only on that
  // transition, not on every render or every switch between build modes
  // (e.g. PC mode straight to BB mode), so a user who unchecks it while
  // still building doesn't get overridden again until they leave and
  // re-enter build mode.
  const prevBuildRef = useRef(expMode.build);
  useEffect(() => {
    if (prevBuildRef.current === 0 && expMode.build !== 0) {
      setDisplayBools((prev) => ({ ...prev, previewPaths: true }));
    }
    prevBuildRef.current = expMode.build;
  }, [expMode.build]);

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
          startError={liveStartError}
        />
      </div>

      {/* Right Sidebar */}
      <aside className="control-bar">
        <div className="control-bar-content">
          <div className="control-bar-group setup-experiment-group">
            <SetUpExperimentPanel
              experiment={experiment}
              setExperiment={setExperiment}
              addSternGerlach={addSternGerlach}
              expMode={expMode}
              setExpMode={setExpMode}
              controlsLocked={controlsLocked}
              displayBools={displayBools}
              setDisplayBools={setDisplayBools}
              resetDataCollection={resetDataCollection}
            />
          </div>
          {/* Data Collection Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Data Collection Controls</h3>
            <div style = {{ display: 'flex', flexDirection: 'row', gap: '10px', alignItems: 'center' }}>
              <p style={{ fontSize: '14px', fontWeight: '500' }}>Mode:</p>
              <div style = {{ padding: '2px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label><input type="radio" name="DCmode" value="single" checked={expMode.dc === 'single'} onChange={(event) => {setExpMode({ ...expMode, dc: event.target.value });}} disabled={expMode.build !== 0} />One at a time</label>
                <label><input type="radio" name="DCmode" value="stream" checked={expMode.dc === 'stream'} onChange={(event) => {setExpMode({ ...expMode, dc: event.target.value });}} disabled={expMode.build !== 0} />Continuous</label>
              </div>
            </div>
            <div className="control-group" style={{ marginTop: '0.5em' }}>
              <SliderPlusTextboxControl
                label="Particles per Second"
                valueNum={expMode.rate}
                onChangeNum={(val) => {setExpMode({ ...expMode, rate: val });}}
                min={0.0}
                max={100}
                step={1.0}
                disabled={(expMode.build !== 0) || (expMode.dc === 'single')}
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
          <div className="control-bar-group" style={{ flexDirection: 'row', flex: '1 1 auto', gap: '10px', minWidth: histDisplayBools.showLegend ? '650px' : '450px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <h3 style={{ padding: '0px 0px 4px 0px' }}>Chart Options</h3>
              <div style = {{ padding: '0px', display: 'flex', flexDirection: 'row', gap: '4px', alignItems: 'center' }}>
                <p style={{ padding: '0px 4px 0 0', fontSize: '14px', fontWeight: '500' }}>Show:</p>
                <div style = {{ padding: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label><input type="radio" name="barLabelMode" value={0} disabled={expMode.build !== 0} checked={histDisplayBools.showPercentages === 0} onChange={(event) => {setHistDisplayBools({ ...histDisplayBools, showPercentages: Number(event.target.value) });}} />Counts</label>
                  <label><input type="radio" name="barLabelMode" value={1} disabled={expMode.build !== 0} checked={histDisplayBools.showPercentages === 1} onChange={(event) => {setHistDisplayBools({ ...histDisplayBools, showPercentages: Number(event.target.value) });}} />Percentages</label>
                  <label><input type="radio" name="barLabelMode" value={2} disabled={expMode.build !== 0} checked={histDisplayBools.showPercentages === 2} onChange={(event) => {setHistDisplayBools({ ...histDisplayBools, showPercentages: Number(event.target.value) });}} />Both</label>
                </div>
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
              <label style={{ padding: '4px 0 0 0', fontWeight: '500' }}>Right-click the plot to copy/save!</label>
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