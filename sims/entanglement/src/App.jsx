import { useState, useRef, useEffect } from 'react';
import './App.css';
import LabPanel from './LabPanel';
import Histogram from './Histogram';
import { AxisStepper, SliderPlusTextboxControl } from './controls';
import { SG_OPTION_LABELS, SG_OPTION_BASES } from './axisOptions';

// Unicode glyphs (▶ ⏸) bake their own, font-dependent vertical padding into
// the glyph box, so flexbox centering lines up the boxes but not the visible
// ink -- see the Stern-Gerlach sim's App.jsx for the same reasoning. Drawing
// them as SVG paths instead sidesteps that.
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

// Fixed detector colors for each side -- colorId only lives on the up/down
// objects themselves, so restoring a side's two detectors after a beam
// block is unchecked (see setBlocked below) needs to know what to put back.
const DETECTOR_COLOR_IDS = {
  0: { up: 0, down: 1 }, // left
  1: { up: 2, down: 3 }, // right
};

// Thin adapter from the generic AxisStepper (controls.jsx) to "this is
// analyzer `index`'s own measurement basis" -- same role as the
// Stern-Gerlach sim's SGBasisStepper, plus this sim's own two additions:
// the "Set by angles" toggle (rendered as its own button here, rather than
// AxisStepper's built-in one, so it can sit on its own row alongside the
// beam-block checkbox -- see the layout comment below) and the checkbox
// itself. There's no chain-position bookkeeping to worry about, unlike the
// Stern-Gerlach sim's version -- this sim always has exactly two analyzers:
// index 0 measures the left-going particle, index 1 the right-going one.
function AnalyzerStepper({ index, sg, setExperiment, disabled, resetDataCollection }) {
  const currentIndex = SG_OPTION_BASES.findIndex(
    ([theta, phi]) => theta === sg.basis[0] && phi === sg.basis[1]
  );
  const label = index === 0 ? 'Left' : 'Right';

  const step = (delta) => {
    setExperiment((prev) => {
      const base = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = (base + delta + SG_OPTION_LABELS.length) % SG_OPTION_LABELS.length;
      const next = [...prev];
      next[index] = { ...next[index], basis: SG_OPTION_BASES[nextIndex] };
      return next;
    });
    resetDataCollection(); // a basis change is a setup change -- old counts no longer apply
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

  const setAdvanced = (advanced) => {
    setExperiment((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], advanced };
      return next;
    });
    // Not a basis change -- same angle, just a different way to edit it --
    // so no resetDataCollection() here.
  };

  // Blocking a side swaps its SG + two detectors out for a single beam
  // block: there's no analyzer basis to measure in any more, so up/down go
  // to null (which also makes Histogram.jsx's getDetectors stop showing
  // bars for them, the same way a Stern-Gerlach-sim arm with nothing placed
  // on it shows no bar). Unblocking recreates fresh, zeroed detectors with
  // this side's own fixed colors.
  const setBlocked = (blocked) => {
    setExperiment((prev) => {
      const next = [...prev];
      const colors = DETECTOR_COLOR_IDS[index];
      next[index] = {
        ...next[index],
        blocked,
        up: blocked ? null : { type: 'pc', data: 0, colorId: colors.up },
        down: blocked ? null : { type: 'pc', data: 0, colorId: colors.down },
      };
      return next;
    });
    resetDataCollection();
  };

  return (
    // Label + stepper (or, once "Set by angles" is on, the theta/phi
    // textboxes in its place) share one row; the toggle button and the
    // beam-block checkbox sit on their own row underneath, so switching to
    // angle entry never has to fight that row for horizontal space.
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <AxisStepper
        label={label}
        value={sg.basis}
        advanced={sg.advanced}
        onStep={step}
        onSetAngle={setAngle}
        showAdvancedToggle={false}
        disabled={disabled || sg.blocked}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 6px 6px 6px' }}>
        <button
          type="button"
          className={`control-bar-button advanced-toggle-button ${sg.advanced ? 'active' : ''}`}
          aria-label={`Toggle advanced controls for ${label}`}
          onClick={() => setAdvanced(!sg.advanced)}
          disabled={disabled || sg.blocked}
        >
          {sg.advanced ? 'Set by axis' : 'Set by angles'}
        </button>
        <label style={{ fontSize: '13px' }}>
          <input type="checkbox" checked={sg.blocked} onChange={(e) => setBlocked(e.target.checked)} disabled={disabled} />
          Block this particle
        </label>
      </div>
    </div>
  );
}

// The oven always emits a pair in the singlet state; the two colors here
// distinguish the four *detectors* (left-up, left-down, right-up,
// right-down), one PC_COLORS entry each, not the two particles themselves.
const INITIAL_EXPERIMENT = [
  { basis: [0, 0], advanced: false, blocked: false, up: { type: 'pc', data: 0, colorId: 0 }, down: { type: 'pc', data: 0, colorId: 1 } }, // left
  { basis: [0, 0], advanced: false, blocked: false, up: { type: 'pc', data: 0, colorId: 2 }, down: { type: 'pc', data: 0, colorId: 3 } }, // right
];

export default function App() {
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,
  });
  const [histDisplayBools, setHistDisplayBools] = useState({
    showPercentages: 2,    // 0 = counts only, 1 = percentages only, 2 = both
    showTheory: false,
    showLegend: true,
    showTotal: true,
    showErrorBars: false,
    hoveredDetector: null, // { sgIndex, arm } the mouse is over in the histogram, or null -- shared with LabPanel so it can highlight that detector
  });
  // dc (data collection) is 'single' or 'stream'; rate is particles/sec in
  // stream mode. There's no `build` mode here -- the setup is fixed.
  const [expMode, setExpMode] = useState({ dc: 'single', running: false, rate: 20 });
  const [experiment, setExperiment] = useState(INITIAL_EXPERIMENT);

  // Pauses particle production (and, via the tabVisible prop, LabPanel's own
  // animation loop) while this tab isn't the active one -- same reasoning as
  // the Stern-Gerlach sim's App.jsx.
  const [tabVisible, setTabVisible] = useState(!document.hidden);
  useEffect(() => {
    const onVisibilityChange = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const labPanelRef = useRef(null);
  const [particleCount, setParticleCount] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const streamTimerRef = useRef(null);

  const controlsLocked = particleCount > 0;

  // A basis change invalidates whatever's been collected so far -- called
  // explicitly at every site that changes a setting, rather than watched via
  // an effect on `experiment` itself, since the detector counts also live
  // inside `experiment` and a structure-watching effect would zero itself
  // out the instant a particle actually landed.
  const resetDataCollection = () => {
    setResetToken((t) => t + 1);
    setExpMode((prev) => ({ ...prev, running: false }));
    setExperiment((prev) => prev.map((sg) => ({
      ...sg,
      up: sg.up ? { ...sg.up, data: 0 } : sg.up,
      down: sg.down ? { ...sg.down, data: 0 } : sg.down,
    })));
  };

  const handleStartPause = () => {
    if (expMode.dc === 'single') {
      labPanelRef.current?.spawnParticle();
      return;
    }
    setExpMode((prev) => ({ ...prev, running: !prev.running }));
  };

  useEffect(() => {
    if (expMode.dc === 'stream' && expMode.running && tabVisible) {
      streamTimerRef.current = setInterval(() => {
        labPanelRef.current?.spawnParticle();
      }, 1 / expMode.rate * 1000);
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
          displayBools={displayBools}
          setParticleCount={setParticleCount}
          resetToken={resetToken}
          tabVisible={tabVisible}
          hoveredDetector={histDisplayBools.hoveredDetector}
        />
      </div>

      {/* Right Sidebar */}
      <aside className="control-bar">
        <div className="control-bar-content">
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 10px 0', fontWeight: 'bold' }}>Set Analyzer Orientations</h3>
            {experiment.map((sg, i) => (
              <AnalyzerStepper
                key={i}
                index={i}
                sg={sg}
                setExperiment={setExperiment}
                disabled={controlsLocked}
                resetDataCollection={resetDataCollection}
              />
            ))}

            {/*
            <h3 style={{ margin: '8px 0 8px 0', fontWeight: 'bold' }}>Display Options</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 0 0 2px' }}>
              <label>
                <input type="checkbox" checked={displayBools.gridOn} onChange={(e) => setDisplayBools({ ...displayBools, gridOn: e.target.checked })} />
                Show grid
              </label>
            </div>
            */}
          </div>

          {/* Data Collection Controls */}
          <div className="control-bar-group">
            <h3 style={{ margin: '0 0 6px 0', fontWeight: 'bold' }}>Data Collection Controls</h3>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '10px', alignItems: 'center' }}>
              <p style={{ fontSize: '14px', fontWeight: '500' }}>Mode:</p>
              <div style={{ padding: '2px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label><input type="radio" name="DCmode" value="single" checked={expMode.dc === 'single'} onChange={(event) => { setExpMode({ ...expMode, dc: event.target.value }); }} />One at a time</label>
                <label><input type="radio" name="DCmode" value="stream" checked={expMode.dc === 'stream'} onChange={(event) => { setExpMode({ ...expMode, dc: event.target.value }); }} />Continuous</label>
              </div>
            </div>
            {expMode.dc === 'stream' &&
              <div className="control-group" style={{ marginTop: '0.5em' }}>
                <SliderPlusTextboxControl
                  label="Pairs per Second"
                  valueNum={expMode.rate}
                  onChangeNum={(val) => { setExpMode({ ...expMode, rate: val }); }}
                  min={0.0}
                  max={100}
                  step={1.0}
                  disabled={expMode.dc === 'single'}
                />
              </div>
            }
            <button className="control-bar-button" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={handleStartPause}>
              {expMode.dc === 'single'
                ? (<><PlayIcon /> Make One Pair</>)
                : expMode.running
                  ? (<><StopIcon /> Stop</>)
                  : (<><PlayIcon /> Start</>)}
            </button>
            <button className="control-bar-button" onClick={resetDataCollection}>
              Reset Data Collection
            </button>
          </div>

          {/* Histogram canvas area */}
          <div className="control-bar-group" style={{ flexDirection: 'row', flex: '1 1 auto', gap: '10px', minWidth: histDisplayBools.showLegend ? '650px' : '450px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <h3 style={{ padding: '0px 0px 4px 0px' }}>Chart Options</h3>
              <div style={{ padding: '0px', display: 'flex', flexDirection: 'row', gap: '3px', alignItems: 'center' }}>
                <p style={{ padding: '0px 4px 0 0', fontSize: '14px', fontWeight: '500' }}>Show:</p>
                <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label><input type="radio" name="barLabelMode" value={0} checked={histDisplayBools.showPercentages === 0} onChange={(event) => { setHistDisplayBools({ ...histDisplayBools, showPercentages: Number(event.target.value) }); }} />Counts</label>
                  <label><input type="radio" name="barLabelMode" value={1} checked={histDisplayBools.showPercentages === 1} onChange={(event) => { setHistDisplayBools({ ...histDisplayBools, showPercentages: Number(event.target.value) }); }} />Percentages</label>
                  <label><input type="radio" name="barLabelMode" value={2} checked={histDisplayBools.showPercentages === 2} onChange={(event) => { setHistDisplayBools({ ...histDisplayBools, showPercentages: Number(event.target.value) }); }} />Both</label>
                </div>
              </div>
              <label style={{ padding: '0px 0 0 0' }}>
                <input type="checkbox" checked={histDisplayBools.showErrorBars} onChange={(e) => setHistDisplayBools({ ...histDisplayBools, showErrorBars: e.target.checked })} />
                Show error bars
              </label>
              <label style={{ padding: '0px 0 0 0' }}>
                <input type="checkbox" checked={histDisplayBools.showLegend} onChange={(e) => setHistDisplayBools({ ...histDisplayBools, showLegend: e.target.checked })} />
                Show legend
              </label>
              <label style={{ padding: '0px 0 0 0' }}>
                <input type="checkbox" checked={histDisplayBools.showTotal} onChange={(e) => setHistDisplayBools({ ...histDisplayBools, showTotal: e.target.checked })} />
                Show running total
              </label>
              <label style={{ padding: '0px 0 0 0' }}>
                <input type="checkbox" checked={histDisplayBools.showTheory} onChange={(e) => setHistDisplayBools({ ...histDisplayBools, showTheory: e.target.checked })} />
                Theoretical probabilities
              </label>
              <label style={{ padding: '4px 0 0 0', fontWeight: '500', width: '220px' }}>Right-click the plot to copy/save!</label>
            </div>
            <div className="histogram-panel">
              <div className="histogram-canvas-wrap">
                <Histogram experiment={experiment} displayBools={histDisplayBools} setDisplayBools={setHistDisplayBools} />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
