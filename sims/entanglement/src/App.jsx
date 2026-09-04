import { useState, useRef, useEffect } from 'react';
import './App.css';
import LabPanel from './LabPanel';
import Histogram from './Histogram';
import { AxisStepper, SliderPlusTextboxControl } from './controls';
import { SG_OPTION_LABELS, SG_OPTION_BASES } from './axisOptions';
import { BELL_STATES } from './physics';
import Ket from './ket';
import ArrowIcon from './arrowIcon';

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

// A ket holding one two-particle up/down-Z basis state, e.g. |up,up> or
// |up,down> -- the arrow pair is the actual content, sized down slightly
// from the ket's own size so the two arrows plus the brackets read as one
// balanced unit rather than the arrows crowding the brackets.
function SpinKet({ arms, size = 16 }) {
  return (
    <Ket size={size}>
      <ArrowIcon direction={arms[0]} size={size * 0.7} />
      <ArrowIcon direction={arms[1]} size={size * 0.7} />
    </Ket>
  );
}

// One Bell state's own up/down-Z decomposition, e.g. "|up,down> - |down,up>"
// for psiMinus -- built from that state's `terms` (physics.js's own plain
// data, not JSX, so that file stays UI-free): each term is either an
// [arm, arm] pair (rendered as a SpinKet) or a bare '+'/'-' operator
// (rendered as text).
function BellStateExpression({ bell, size = 16 }) {
  return bell.terms.map((term, i) => (
    Array.isArray(term)
      ? <SpinKet key={i} arms={term} size={size} />
      : <span key={i}>{` ${term} `}</span>
  ));
}

// The "Source Controls" sidebar: picks what the oven emits each pair in --
// a classical hidden-variable mixture, one of the four Bell states, or an
// arbitrary custom quantum state -- and owns just enough state (sourceType,
// plus one slot each for the Bell and custom sub-choices) for App to derive
// the actual `source` object physics.js expects. sourceType alone decides
// which of the other two is *used*; both persist across switches, so
// flipping the dropdown back and forth doesn't lose a custom state you'd
// already typed in.
function SourceControls({ sourceType, setSourceType, bellKey, setBellKey, customCoeffs, setCustomCoeffs, disabled, resetDataCollection }) {
  const selectedBell = BELL_STATES.find((b) => b.key === bellKey);

  const changeType = (type) => {
    setSourceType(type);
    resetDataCollection(); // a different source is a setup change -- old counts no longer apply
  };
  const changeBell = (key) => {
    setBellKey(key);
    resetDataCollection();
  };
  const changeCoeff = (which, value) => {
    setCustomCoeffs((prev) => ({ ...prev, [which]: value }));
    resetDataCollection();
  };

  return (
    <>
      <h3 style={{ margin: '0 0 10px 0', fontWeight: 'bold' }}>Source Controls</h3>
      <select
        value={sourceType}
        onChange={(e) => changeType(e.target.value)}
        disabled={disabled}
        style={{ width: '100%', padding: '6px', fontSize: '13px' }}
      >
        <option value="classical">Classical (Mixed)</option>
        <option value="bell">Quantum Bell State</option>
        <option value="custom">Quantum Custom State</option>
      </select>

      {sourceType === 'classical' && (
        <p style={{ fontSize: '13px', margin: '10px 0 0 0', lineHeight: '1.6' }}>
          A 50/50 mixture of <SpinKet arms={['up', 'up']} /> and <SpinKet arms={['down', 'down']} /> --
          each pair definitely has one of these two states, never a superposition of them.
        </p>
      )}

      {sourceType === 'bell' && (
        <>
          <div style={{ display: 'flex', gap: '6px', margin: '10px 0 10px 0' }}>
            {BELL_STATES.map((b) => (
              <button
                key={b.key}
                type="button"
                className={`control-bar-button ${bellKey === b.key ? 'active' : ''}`}
                style={{ flex: 1, aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                onClick={() => changeBell(b.key)}
                disabled={disabled}
                aria-label={`Select the ${b.letter}${b.sign} Bell state`}
              >
                <Ket size={22}>{b.letter}{b.sign}</Ket>
              </button>
            ))}
          </div>
          <p style={{ fontSize: '13px', margin: 0, lineHeight: '1.6' }}>
            <Ket size={16}>{selectedBell.letter}{selectedBell.sign}</Ket> = (<BellStateExpression bell={selectedBell} />)/√2
          </p>
        </>
      )}

      {sourceType === 'custom' && (
        <>
          <p style={{ fontSize: '13px', margin: '10px 0 8px 0', lineHeight: '1.6' }}>
            <span style={{ whiteSpace: 'nowrap' }}>a<SpinKet arms={['up', 'up']} size={14} /></span>{' + '}
            <span style={{ whiteSpace: 'nowrap' }}>b<SpinKet arms={['up', 'down']} size={14} /></span>{' + '}
            <span style={{ whiteSpace: 'nowrap' }}>c<SpinKet arms={['down', 'up']} size={14} /></span>{' + '}
            <span style={{ whiteSpace: 'nowrap' }}>d<SpinKet arms={['down', 'down']} size={14} /></span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {['a', 'b', 'c', 'd'].map((k) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <span style={{ minWidth: '24px', whiteSpace: 'nowrap' }}>{k} =</span>
                <input
                  type="number"
                  step="0.01"
                  value={customCoeffs[k]}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v)) changeCoeff(k, v);
                  }}
                  disabled={disabled}
                  style={{ width: '80px', padding: '2px' }}
                />
              </label>
            ))}
          </div>
          <p style={{ fontSize: '12px', color: '#666', margin: '8px 0 0 0', lineHeight: '1.5' }}>
            Coefficients don't need to be normalized -- (1, 0, 0, 1) works
            just as well as (1/√2, 0, 0, 1/√2).
          </p>
        </>
      )}
    </>
  );
}

// The oven always emits a pair in whatever state Source Controls has
// selected; the two colors here distinguish the four *detectors* (left-up,
// left-down, right-up, right-down), one PC_COLORS entry each, not the two
// particles themselves.
const INITIAL_EXPERIMENT = [
  { basis: [0, 0], advanced: false, blocked: false, up: { type: 'pc', data: 0, colorId: 0 }, down: { type: 'pc', data: 0, colorId: 1 } }, // left
  { basis: [0, 0], advanced: false, blocked: false, up: { type: 'pc', data: 0, colorId: 2 }, down: { type: 'pc', data: 0, colorId: 3 } }, // right
];

export default function App() {
  // setDisplayBools has no caller now that the grid checkbox below is
  // commented out -- suppressed rather than removed, since re-enabling
  // that checkbox needs it back.
  // eslint-disable-next-line no-unused-vars
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,
  });
  const [histDisplayBools, setHistDisplayBools] = useState({
    showPercentages: 2,    // 0 = counts only, 1 = percentages only, 2 = both
    showTheory: false,
    showCoincidenceTable: true,
    showTotal: true,
    showErrorBars: false,
    hoveredDetector: null, // { sgIndex, arm } the mouse is over in the histogram, or null -- shared with LabPanel so it can highlight that detector
  });
  // dc (data collection) is 'single' or 'stream'; rate is particles/sec in
  // stream mode. There's no `build` mode here -- the setup is fixed.
  const [expMode, setExpMode] = useState({ dc: 'single', running: false, rate: 20 });
  const [experiment, setExperiment] = useState(INITIAL_EXPERIMENT);
  // Joint (coincidence) counts across both particles of a pair -- one entry
  // per combination of arms, keyed the same way physics.js's
  // jointProbabilities is (u/d = up/down, left letter first). This is
  // separate from `experiment`'s own up/down.data counts, which are each
  // detector's own *marginal* total and can't be un-mixed back into the
  // four joint counts -- knowing "248 particles hit Left-down" doesn't say
  // how many of those paired with a Right-up versus Right-down partner.
  // LabPanel's recordCoincidence call (via its onCoincidence prop) is the
  // only writer; Histogram's coincidence table is the only reader.
  const [coincidences, setCoincidences] = useState({ uu: 0, ud: 0, du: 0, dd: 0 });

  // What the oven emits each pair in -- see physics.js's own comment on the
  // `source` shape this ultimately builds. sourceType picks which of the
  // other two is actually used; bellKey and customCoeffs each keep their
  // own state regardless, so switching the dropdown back and forth doesn't
  // lose a custom state already typed in. Defaults reproduce this sim's
  // original, Source-Controls-less behavior exactly: sourceType 'bell' with
  // bellKey 'psiMinus' is the singlet.
  const [sourceType, setSourceType] = useState('bell');
  const [bellKey, setBellKey] = useState('psiMinus');
  const [customCoeffs, setCustomCoeffs] = useState({ a: 1, b: 0, c: 0, d: 1 });
  const source = sourceType === 'classical'
    ? { kind: 'classical' }
    : sourceType === 'bell'
      ? { kind: 'quantum', coeffs: BELL_STATES.find((b) => b.key === bellKey).coeffs }
      : {
          kind: 'quantum',
          coeffs: {
            uu: { re: customCoeffs.a, im: 0 },
            ud: { re: customCoeffs.b, im: 0 },
            du: { re: customCoeffs.c, im: 0 },
            dd: { re: customCoeffs.d, im: 0 },
          },
        };

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
    setCoincidences({ uu: 0, ud: 0, du: 0, dd: 0 });
  };

  // LabPanel calls this once per pair, but only when *both* particles
  // actually reached a detector (see its own tick loop) -- a blocked side
  // never has a real arm to report, so a pair with either side blocked
  // never gets here at all, and the table simply has nothing to show.
  const recordCoincidence = (armL, armR) => {
    const key = (armL === 'up' ? 'u' : 'd') + (armR === 'up' ? 'u' : 'd');
    setCoincidences((prev) => ({ ...prev, [key]: prev[key] + 1 }));
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
      {/* Everything above the bottom control bar: the canvas and, alongside
          it, the Source Controls sidebar -- sharing this row is what makes
          the sidebar span full height down to the bottom bar's own top
          edge, rather than sitting inside or below it. */}
      <div className="top-row">
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
            onCoincidence={recordCoincidence}
            source={source}
          />
        </div>

        <aside className="source-sidebar">
          <SourceControls
            sourceType={sourceType}
            setSourceType={setSourceType}
            bellKey={bellKey}
            setBellKey={setBellKey}
            customCoeffs={customCoeffs}
            setCustomCoeffs={setCustomCoeffs}
            disabled={controlsLocked}
            resetDataCollection={resetDataCollection}
          />
        </aside>
      </div>

      {/* Bottom Sidebar */}
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
          <div className="control-bar-group" style={{ flexDirection: 'row', flex: '1 1 auto', gap: '10px', minWidth: histDisplayBools.showCoincidenceTable ? '650px' : '450px' }}>
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
                <input type="checkbox" checked={histDisplayBools.showCoincidenceTable} onChange={(e) => setHistDisplayBools({ ...histDisplayBools, showCoincidenceTable: e.target.checked })} />
                Show coincidence table
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
                <Histogram experiment={experiment} displayBools={histDisplayBools} setDisplayBools={setHistDisplayBools} coincidences={coincidences} source={source} />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
