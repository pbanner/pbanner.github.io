// Parameter-sweep UI: the spec modal (SweepSpecModal, triggered from
// WaveplateAngleControl's "Sweep Angle..." button) and the results panel
// (SweepResultsPanel, which App.jsx swaps in for DataPlottingPanel once a
// sweep starts running -- see its own sweepState). Two components in one
// file, same convention as panels.jsx, since eslint's react-refresh rule
// only objects to a *non*-component export sharing a file with a component,
// not to multiple components sharing one.
import { useState, useMemo, useRef, useEffect } from 'react';
import { getComponentType } from './componentTypes.js';
import { PC_COLORS } from './colors.js';
import { StopIcon } from './controls.jsx';
import { compileTrialFunction } from './sweepMath.js';

const SWEEP_MAX_POINTS = 2000; // a hard backstop against a typo (e.g. a near-zero step) hanging the browser, not a pedagogical limit -- see SweepSpecModal's own comment
const SWEEP_MAX_SHOTS_PER_POINT = 10000;
const SWEEP_DEFAULT_SHOTS = 100;

function parseRangeValues(startStr, stopStr, stepStr) {
  if (startStr === '' || stopStr === '' || stepStr === '') return { values: null, error: null };
  const start = parseFloat(startStr);
  const stop = parseFloat(stopStr);
  const step = parseFloat(stepStr);
  if ([start, stop, step].some((v) => Number.isNaN(v))) return { values: null, error: 'Start, stop, and step must be numbers.' };
  if (step === 0) return { values: null, error: "Step can't be zero." };
  if ((stop - start) * step < 0) return { values: null, error: "Step doesn't point from start toward stop." };
  const n = Math.floor((stop - start) / step + 1e-9);
  if (n + 1 > SWEEP_MAX_POINTS) {
    return { values: null, error: `That's ${(n + 1).toLocaleString()} points -- more than one sweep can hold (${SWEEP_MAX_POINTS.toLocaleString()}).` };
  }
  const values = [];
  for (let i = 0; i <= n; i++) values.push(start + i * step);
  return { values, error: null };
}

function parseListValues(listStr) {
  const parts = listStr.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { values: null, error: null };
  const values = [];
  for (const p of parts) {
    const v = parseFloat(p);
    if (Number.isNaN(v)) return { values: null, error: `"${p}" isn't a number.` };
    values.push(v);
  }
  if (values.length > SWEEP_MAX_POINTS) {
    return { values: null, error: `That's ${values.length.toLocaleString()} points -- more than one sweep can hold (${SWEEP_MAX_POINTS.toLocaleString()}).` };
  }
  return { values, error: null };
}

// The sweep spec modal -- a dimmed full-screen backdrop with a centered
// card, deliberately unlike every other panel in this sim (which are all
// docked overlays a student can ignore mid-fill). Specifying a sweep is a
// one-shot commitment (see the derived readout below), and the backdrop is
// what makes that feel like a deliberate step rather than a form left half
// filled out. Clicking the backdrop itself (not the card) cancels, same as
// clicking the Cancel button.
export function SweepSpecModal({ component, initialConfig, onCancel, onStart }) {
  const type = getComponentType(component?.type);
  const [mode, setMode] = useState(initialConfig?.mode ?? 'range');
  const [start, setStart] = useState(initialConfig?.start ?? '');
  const [stop, setStop] = useState(initialConfig?.stop ?? '');
  const [step, setStep] = useState(initialConfig?.step ?? '');
  const [list, setList] = useState(initialConfig?.list ?? '');
  const [shotsText, setShotsText] = useState(String(initialConfig?.shots ?? SWEEP_DEFAULT_SHOTS));

  const { values, error: rangeError } = mode === 'range'
    ? parseRangeValues(start, stop, step)
    : parseListValues(list);

  const shots = parseInt(shotsText, 10);
  const shotsValid = Number.isInteger(shots) && shots >= 1 && shots <= SWEEP_MAX_SHOTS_PER_POINT;
  const shotsError = shotsText === '' || shotsValid
    ? null
    : `Shots per point must be a whole number from 1 to ${SWEEP_MAX_SHOTS_PER_POINT.toLocaleString()}.`;

  const error = rangeError || shotsError;
  const canStart = !!(values && values.length > 0 && shotsValid && !error);
  const totalPhotons = values && shotsValid ? values.length * shots : null;

  const handleStart = () => {
    if (!canStart) return;
    onStart({ mode, start, stop, step, list, shots, values });
  };

  return (
    <div className="sweep-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sweep-modal-card">
        <h3 className="sweep-modal-title">Sweep {type ? `${type.label} Angle` : 'Angle'}</h3>

        <div className="sweep-modal-mode-toggle">
          <button type="button" className={`control-bar-button ${mode === 'range' ? 'active' : ''}`} onClick={() => setMode('range')}>Range</button>
          <button type="button" className={`control-bar-button ${mode === 'list' ? 'active' : ''}`} onClick={() => setMode('list')}>List</button>
        </div>

        {mode === 'range' ? (
          <div className="sweep-modal-range-row">
            <label className="sweep-modal-field">
              <span>Start</span>
              <div className="sweep-modal-field-input">
                <input type="number" value={start} onChange={(e) => setStart(e.target.value)} placeholder="0" />
                <span>°</span>
              </div>
            </label>
            <label className="sweep-modal-field">
              <span>Stop</span>
              <div className="sweep-modal-field-input">
                <input type="number" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="360" />
                <span>°</span>
              </div>
            </label>
            <label className="sweep-modal-field">
              <span>Step</span>
              <div className="sweep-modal-field-input">
                <input type="number" value={step} onChange={(e) => setStep(e.target.value)} placeholder="10" />
                <span>°</span>
              </div>
            </label>
          </div>
        ) : (
          <label className="sweep-modal-field sweep-modal-list-field">
            <span>Values (comma or space separated, degrees)</span>
            <input type="text" value={list} onChange={(e) => setList(e.target.value)} placeholder="0, 22.5, 45, 67.5, 90" />
          </label>
        )}

        <label className="sweep-modal-field sweep-modal-shots-field">
          <span>Shots per point</span>
          <input type="number" min="1" step="1" value={shotsText} onChange={(e) => setShotsText(e.target.value)} />
        </label>

        <p className="sweep-modal-readout">
          {totalPhotons != null
            ? <>{values.length.toLocaleString()} points × {shots.toLocaleString()} shots = <strong>{totalPhotons.toLocaleString()} photons</strong></>
            : 'Fill in every field to see how much data this will collect.'}
        </p>

        {error && <p className="sweep-modal-error">{error}</p>}

        <div className="sweep-modal-buttons">
          <button type="button" className="control-bar-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="control-bar-button active" disabled={!canStart} onClick={handleStart}>Start Sweep</button>
        </div>
      </div>
    </div>
  );
}

// --- Results panel + scatter plot ------------------------------------

const PLOT_PADDING_TOP = 12;
const PLOT_PADDING_RIGHT = 14;
const PLOT_PADDING_BOTTOM = 26;
const PLOT_PADDING_LEFT = 34;
const AXIS_COLOR = '#303030';
const TICK_LABEL_COLOR = '#606060';
const POINT_RADIUS = 4;
const ERROR_BAR_CAP = 4;
const TRIAL_LINE_COLOR = '#555555';
const TRIAL_LINE_WIDTH = 2;
const TRIAL_LINE_STEPS = 200;
const HOVER_HIT_RADIUS_PX = 12;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const X_TICK_COUNT = 5;

// One dot + error bar per (point, detector) with any hits, a hoverable
// tooltip in place of a separate data table (this app's histogram already
// has an analogous hover pattern -- see Histogram.jsx's bar hover/loupe),
// and an optional trial-function overlay curve. Binomial standard error
// (sqrt(p(1-p)/N)) uses N = photons detected *at some placed detector* for
// that point, matching how the histogram's own percentages and theory line
// are normalized elsewhere in this sim -- a point where every photon was
// absorbed/escaped (N=0) simply isn't drawn.
function SweepScatterPlot({ points, detectors, xDomain, trialFn }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ width: 400, height: 200 });
  const [hover, setHover] = useState(null);
  const screenPointsRef = useRef([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const resize = () => setDims({ width: wrap.clientWidth, height: wrap.clientHeight });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.width === 0 || dims.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    canvas.style.width = `${dims.width}px`;
    canvas.style.height = `${dims.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.width, dims.height);

    const plotX0 = PLOT_PADDING_LEFT;
    const plotX1 = dims.width - PLOT_PADDING_RIGHT;
    const plotY0 = PLOT_PADDING_TOP;
    const plotY1 = dims.height - PLOT_PADDING_BOTTOM;

    const [xMin, xMax] = xDomain;
    const xSpan = xMax - xMin || 1;
    const xToPx = (x) => plotX0 + ((x - xMin) / xSpan) * (plotX1 - plotX0);
    const yToPx = (y) => plotY1 - y * (plotY1 - plotY0);

    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotX0, plotY0);
    ctx.lineTo(plotX0, plotY1);
    ctx.lineTo(plotX1, plotY1);
    ctx.stroke();

    ctx.font = '10px Arial';
    ctx.fillStyle = TICK_LABEL_COLOR;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    Y_TICKS.forEach((frac) => {
      const y = yToPx(frac);
      ctx.strokeStyle = AXIS_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX0 - 4, y);
      ctx.lineTo(plotX0, y);
      ctx.stroke();
      ctx.fillText(frac.toFixed(2), plotX0 - 6, y);
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= X_TICK_COUNT; i++) {
      const xv = xMin + (xSpan * i) / X_TICK_COUNT;
      const x = xToPx(xv);
      ctx.strokeStyle = AXIS_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plotY1);
      ctx.lineTo(x, plotY1 + 4);
      ctx.stroke();
      ctx.fillStyle = TICK_LABEL_COLOR;
      ctx.fillText(`${xv.toFixed(1)}°`, x, plotY1 + 6);
    }

    if (trialFn) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(plotX0, plotY0, plotX1 - plotX0, plotY1 - plotY0);
      ctx.clip();
      ctx.strokeStyle = TRIAL_LINE_COLOR;
      ctx.lineWidth = TRIAL_LINE_WIDTH;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= TRIAL_LINE_STEPS; i++) {
        const xv = xMin + (xSpan * i) / TRIAL_LINE_STEPS;
        let yv;
        try { yv = trialFn(xv); } catch { yv = NaN; }
        if (typeof yv !== 'number' || Number.isNaN(yv) || !Number.isFinite(yv)) { started = false; continue; }
        const px = xToPx(xv);
        const py = yToPx(yv);
        if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
      ctx.restore();
    }

    const screenPoints = [];
    points.forEach((p) => {
      const totalDetected = detectors.reduce((s, d) => s + (p.counts[d.id] ?? 0), 0);
      if (totalDetected === 0) return;
      detectors.forEach((d) => {
        const count = p.counts[d.id] ?? 0;
        const fraction = count / totalDetected;
        const se = Math.sqrt((fraction * (1 - fraction)) / totalDetected);
        const px = xToPx(p.value);
        const py = yToPx(fraction);
        const color = PC_COLORS[d.colorId] ?? '#999999';

        const topPy = yToPx(Math.min(1, fraction + se));
        const botPy = yToPx(Math.max(0, fraction - se));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, topPy);
        ctx.lineTo(px, botPy);
        ctx.moveTo(px - ERROR_BAR_CAP, topPy);
        ctx.lineTo(px + ERROR_BAR_CAP, topPy);
        ctx.moveTo(px - ERROR_BAR_CAP, botPy);
        ctx.lineTo(px + ERROR_BAR_CAP, botPy);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        screenPoints.push({ px, py, value: p.value, detectorLabel: d.label, color, fraction, se, count, total: totalDetected });
      });
    });
    screenPointsRef.current = screenPoints;
  }, [dims, points, detectors, xDomain, trialFn]);

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let closest = null;
    let closestDist = HOVER_HIT_RADIUS_PX;
    screenPointsRef.current.forEach((p) => {
      const dist = Math.hypot(p.px - x, p.py - y);
      if (dist < closestDist) { closest = p; closestDist = dist; }
    });
    setHover(closest ? { ...closest, mouseX: x, mouseY: y } : null);
  };

  return (
    <div className="sweep-plot-wrap" ref={wrapRef} onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
      <canvas ref={canvasRef} />
      {hover && (
        <div className="sweep-plot-tooltip" style={{ left: hover.mouseX + 10, top: hover.mouseY + 10 }}>
          <strong style={{ color: hover.color }}>{hover.detectorLabel}</strong> at {hover.value.toFixed(1)}°<br />
          {(hover.fraction * 100).toFixed(1)}% ± {(hover.se * 100).toFixed(1)}% ({hover.count}/{hover.total})
        </div>
      )}
    </div>
  );
}

// The results panel -- what App.jsx swaps in for DataPlottingPanel once a
// sweep starts running (see its own sweepState), staying up through the
// 'done' phase so results remain visible (and the manual "take data"
// button usable) until Back is pressed. Every placed detector gets its own
// colored series, same PC_COLORS/D1-D2-... convention the histogram uses.
export function SweepResultsPanel({ sweepState, components, onStop, onBack, onTakeManualPoint }) {
  const [trialFnText, setTrialFnText] = useState('');
  const component = components.find((c) => c.id === sweepState.componentId);
  const type = getComponentType(component?.type);
  const currentValue = component?.angle ?? 0;
  const running = sweepState.phase === 'running';

  const detectors = useMemo(
    () => components.filter((c) => c.type === 'detector').map((c, i) => ({ id: c.id, label: `D${i + 1}`, colorId: c.colorId })),
    [components]
  );

  const xDomain = useMemo(() => {
    const allValues = [...sweepState.values, ...sweepState.points.map((p) => p.value)];
    if (allValues.length === 0) return [0, 1];
    let min = Math.min(...allValues);
    let max = Math.max(...allValues);
    if (min === max) { min -= 1; max += 1; }
    return [min, max];
  }, [sweepState.values, sweepState.points]);

  const trialCompiled = useMemo(() => compileTrialFunction(trialFnText), [trialFnText]);

  return (
    <div className="overlay-controls sweep-results-panel">
      <div className="sweep-results-header">
        <h3 style={{ margin: 0, fontWeight: 'bold' }}>{type ? `${type.label} Angle Sweep` : 'Angle Sweep'}</h3>
        {running ? (
          <button type="button" className="control-bar-button active-special" onClick={onStop}><StopIcon /> Stop</button>
        ) : (
          <button type="button" className="control-bar-button" onClick={onBack}>&laquo; Back</button>
        )}
      </div>

      <div className="sweep-results-subheader">
        <p className="sweep-results-progress">
          {running
            ? `Running… ${sweepState.points.length} / ${sweepState.values.length} points`
            : `${sweepState.points.length} point${sweepState.points.length === 1 ? '' : 's'} collected, ${sweepState.shotsPerPoint} shots each`}
        </p>
        {detectors.length > 0 && (
          <div className="sweep-legend">
            {detectors.map((d) => (
              <span key={d.id} className="sweep-legend-item">
                <span className="sweep-legend-swatch" style={{ background: PC_COLORS[d.colorId] ?? '#999999' }} />
                {d.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <SweepScatterPlot
        points={sweepState.points}
        detectors={detectors}
        xDomain={xDomain}
        trialFn={trialCompiled.ok ? trialCompiled.evaluate : null}
      />

      <div className="sweep-trial-row">
        <label>
          <span>Trial function f(θ) =</span>
          <input
            type="text"
            value={trialFnText}
            onChange={(e) => setTrialFnText(e.target.value)}
            placeholder="cos(2*theta)^2"
          />
        </label>
        {trialFnText.trim() && !trialCompiled.ok && <span className="sweep-trial-error">{trialCompiled.error}</span>}
      </div>

      <div className="sweep-manual-row">
        <button type="button" className="control-bar-button" disabled={running} onClick={onTakeManualPoint}>
          Take data at current settings ({currentValue.toFixed(1)}°)
        </button>
      </div>
    </div>
  );
}
