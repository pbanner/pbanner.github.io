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
const PLOT_PADDING_LEFT = 40;
const AXIS_COLOR = '#303030';
const TICK_LABEL_COLOR = '#606060';
const POINT_RADIUS = 4;
const ERROR_BAR_CAP = 4;
const TRIAL_LINE_COLOR = '#555555';
const TRIAL_LINE_WIDTH = 2;
const TRIAL_LINE_STEPS = 200;
const HOVER_HIT_RADIUS_PX = 12;
const X_TICK_COUNT = 5;
const Y_TARGET_TICK_COUNT = 5;
const MIN_AXIS_MAX = 10; // the y-axis never scales below this many counts, even with 0 or few points collected
// Past this fraction of the plot's own width, the hover tooltip opens to
// the *left* of the cursor instead of the right -- otherwise a point near
// the plot's right edge pushes the tooltip past the panel (and often the
// viewport) entirely, which is what was producing a stray horizontal
// scrollbar on the whole page.
const TOOLTIP_FLIP_FRACTION = 0.6;

// A default that visibly does something (an offset, an oscillation) the
// moment a sweep finishes, without being -- or even resembling the shape
// of -- the actual answer a given exercise wants discovered. Swap it for
// whatever's actually being tested and this stops being a good example.
const SWEEP_TRIAL_DEFAULT = '100*cos(theta)+5';

// Picks a "nice" (1/2/5 x a power of ten) tick step spanning [minVal,
// maxVal] -- the same algorithm Histogram.jsx's own niceTicks uses,
// generalized to a range that doesn't have to start at 0: a trial function
// can dip negative (see SWEEP_TRIAL_DEFAULT), even though the data itself
// (raw counts) never does.
function niceTicksRange(minVal, maxValIn, targetCount) {
  const maxVal = maxValIn > minVal ? maxValIn : minVal + 1;
  const span = maxVal - minVal;
  const roughStep = span / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = niceNormalized * magnitude;
  const niceMin = Math.floor(minVal / step) * step;
  const niceMax = Math.ceil(maxVal / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

// Collapsing/expanding triangle glyphs for SweepResultsPanel's Collapse/
// Show toggle -- drawn as SVG (not a Unicode ▲/▼) so they render
// identically regardless of the system's own font, same reasoning as
// LabPanel's RotateIcon/DeleteIcon.
function ShowIcon({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M5 1 L9 8 L1 8 Z" />
    </svg>
  );
}
function CollapseIcon({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M5 9 L1 2 L9 2 Z" />
    </svg>
  );
}

// Binomial standard error of a count k out of n trials, in *count* units
// (not the usual fraction-domain sqrt(p(1-p)/n)) -- this plot deliberately
// shows raw counts rather than a normalized fraction (see SweepScatterPlot's
// own comment), so its error bars need to be in that same domain:
// Var(k) = n*p*(1-p), with phat = k/n plugged in for the unknown p.
function binomialCountSE(k, n) {
  if (n <= 0) return 0;
  return Math.sqrt((k * (n - k)) / n);
}

// One dot + error bar per (point, detector), a hoverable tooltip in place
// of a separate data table (this app's histogram already has an analogous
// hover pattern -- see Histogram.jsx's bar hover/loupe), and an optional
// trial-function overlay curve. Plots raw counts, not a normalized
// fraction: a count is what a student actually reads off a detector, and
// it's what a "100*cos(theta)+5"-style trial function (see
// SWEEP_TRIAL_DEFAULT) is written directly against -- normalizing would
// mean silently rescaling both against a shared denominator ("total
// detected across every placed detector") that isn't a quantity any one
// detector's own count tray shows.
function SweepScatterPlot({ points, detectors, xDomain, xAxisLabel, trialFn }) {
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

    // Trial function samples are computed once here -- reused for both the
    // y-axis's own range below and the actual line draw further down --
    // rather than evaluated twice.
    let trialSamples = null;
    let trialMin = null;
    let trialMax = null;
    if (trialFn) {
      trialSamples = [];
      for (let i = 0; i <= TRIAL_LINE_STEPS; i++) {
        const xv = xMin + (xSpan * i) / TRIAL_LINE_STEPS;
        let yv;
        try { yv = trialFn(xv); } catch { yv = NaN; }
        const valid = typeof yv === 'number' && Number.isFinite(yv);
        trialSamples.push({ xv, yv: valid ? yv : null });
        if (valid) {
          trialMin = trialMin === null ? yv : Math.min(trialMin, yv);
          trialMax = trialMax === null ? yv : Math.max(trialMax, yv);
        }
      }
    }

    let dataMax = 0;
    points.forEach((p) => {
      detectors.forEach((d) => { dataMax = Math.max(dataMax, p.counts[d.id] ?? 0); });
    });

    const yMaxRaw = Math.max(dataMax * 1.15, trialMax ?? 0, MIN_AXIS_MAX);
    const yMinRaw = Math.min(0, trialMin ?? 0);
    const yTicks = niceTicksRange(yMinRaw, yMaxRaw, Y_TARGET_TICK_COUNT);
    const plotYMinVal = yTicks[0];
    const plotYMaxVal = yTicks[yTicks.length - 1];
    const yToPx = (y) => plotY1 - ((y - plotYMinVal) / (plotYMaxVal - plotYMinVal)) * (plotY1 - plotY0);

    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotX0, plotY0);
    ctx.lineTo(plotX0, plotY1);
    ctx.lineTo(plotX1, plotY1);
    ctx.stroke();

    ctx.font = '10px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yTicks.forEach((tickValue) => {
      const y = yToPx(tickValue);
      ctx.strokeStyle = AXIS_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX0 - 4, y);
      ctx.lineTo(plotX0, y);
      ctx.stroke();
      ctx.fillStyle = TICK_LABEL_COLOR;
      ctx.fillText(String(Math.round(tickValue)), plotX0 - 6, y);
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

    // A y=0 baseline, distinct from the axis's own bottom edge, since the
    // plot can now extend below zero to fit a trial function that dips
    // negative -- without this, "zero" data sits floating in the middle of
    // the plot with nothing marking it.
    if (plotYMinVal < 0) {
      const zeroY = yToPx(0);
      ctx.strokeStyle = '#bbbbbb';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX0, zeroY);
      ctx.lineTo(plotX1, zeroY);
      ctx.stroke();
    }

    if (trialSamples) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(plotX0, plotY0, plotX1 - plotX0, plotY1 - plotY0);
      ctx.clip();
      ctx.strokeStyle = TRIAL_LINE_COLOR;
      ctx.lineWidth = TRIAL_LINE_WIDTH;
      ctx.beginPath();
      let started = false;
      trialSamples.forEach(({ xv, yv }) => {
        if (yv === null) { started = false; return; }
        const px = xToPx(xv);
        const py = yToPx(yv);
        if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
      });
      ctx.stroke();
      ctx.restore();
    }

    const screenPoints = [];
    points.forEach((p) => {
      detectors.forEach((d) => {
        const count = p.counts[d.id] ?? 0;
        const se = binomialCountSE(count, p.total);
        const px = xToPx(p.value);
        const py = yToPx(count);
        const color = PC_COLORS[d.colorId] ?? '#999999';

        const topPy = yToPx(count + se);
        const botPy = yToPx(Math.max(0, count - se));
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

        screenPoints.push({ px, py, value: p.value, detectorLabel: d.label, color, count, se, total: p.total });
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
    setHover(closest ? { ...closest, mouseX: x, mouseY: y, anchorRight: x > dims.width * TOOLTIP_FLIP_FRACTION } : null);
  };

  return (
    <div className="sweep-plot-outer">
      <div className="sweep-plot-ylabel">Counts</div>
      <div className="sweep-plot-main">
        <div className="sweep-plot-wrap" ref={wrapRef} onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
          <canvas ref={canvasRef} />
          {hover && (
            <div
              className="sweep-plot-tooltip"
              style={hover.anchorRight
                ? { right: dims.width - hover.mouseX + 10, top: hover.mouseY + 10 }
                : { left: hover.mouseX + 10, top: hover.mouseY + 10 }}
            >
              <strong style={{ color: hover.color }}>{hover.detectorLabel}</strong> at {hover.value.toFixed(1)}°<br />
              {hover.count} ± {hover.se.toFixed(1)} counts (of {hover.total} shots)
            </div>
          )}
        </div>
        <div className="sweep-plot-xlabel">{xAxisLabel}</div>
      </div>
    </div>
  );
}

// angle_deg first (per-spec), then each detector's own count/uncertainty
// pair -- grouped by detector rather than all-counts-then-all-uncertainties,
// so a spreadsheet's own column order reads the same way the legend does.
function buildSweepCsv(sweepState, detectors) {
  const header = ['angle_deg', ...detectors.flatMap((d) => [`${d.label}_count`, `${d.label}_uncertainty`])];
  const rows = sweepState.points.map((p) => {
    const cells = [p.value];
    detectors.forEach((d) => {
      const count = p.counts[d.id] ?? 0;
      cells.push(count, binomialCountSE(count, p.total).toFixed(3));
    });
    return cells.join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// The results panel -- what App.jsx swaps in for DataPlottingPanel once a
// sweep starts running (see its own sweepState), staying up through the
// 'done' phase so results remain visible (and the manual "take data"
// button usable) until Back is pressed. Every placed detector gets its own
// colored series, same PC_COLORS/D1-D2-... convention the histogram uses.
//
// collapsed is local, throwaway UI state (not part of sweepState) -- it's
// purely "how much of this panel is on screen right now," unrelated to the
// sweep's own run/lock/data lifecycle, so a fresh sweep always reopens
// uncollapsed regardless of how the last one was left.
export function SweepResultsPanel({ sweepState, components, onStop, onBack, onTakeManualPoint }) {
  const [trialFnText, setTrialFnText] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
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

  const title = type ? `${type.label} Angle Sweep` : 'Angle Sweep';
  const xAxisLabel = `${type ? type.label : 'Swept parameter'} Angle θ (degrees)`;
  const progressText = running
    ? `Running… ${sweepState.points.length} / ${sweepState.values.length} points`
    : `${sweepState.points.length} point${sweepState.points.length === 1 ? '' : 's'} collected, ${sweepState.shotsPerPoint} shots each`;

  const handleSaveCsv = () => {
    const csv = buildSweepCsv(sweepState, detectors);
    const filename = `${(type?.label ?? 'sweep').replace(/\s+/g, '_').toLowerCase()}_angle_sweep.csv`;
    downloadCsv(filename, csv);
  };

  if (collapsed) {
    return (
      <div className="overlay-controls sweep-results-panel sweep-results-panel-collapsed">
        <div className="sweep-results-header">
          <h3 style={{ margin: 0, fontWeight: 'bold' }}>{title}</h3>
          <div className="sweep-results-header-buttons">
            <button type="button" className="control-bar-button" onClick={() => setCollapsed(false)}>
              <ShowIcon /> Show
            </button>
            {!running && <button type="button" className="control-bar-button" onClick={onBack}>&laquo; Back</button>}
          </div>
        </div>
        <p className="sweep-results-progress">{progressText}</p>
      </div>
    );
  }

  return (
    <div className="overlay-controls sweep-results-panel">
      <div className="sweep-results-header">
        <h3 style={{ margin: 0, fontWeight: 'bold' }}>{title}</h3>
        <div className="sweep-results-header-buttons">
          <button type="button" className="control-bar-button" onClick={() => setCollapsed(true)}>
            <CollapseIcon /> Collapse
          </button>
          {running ? (
            <button type="button" className="control-bar-button active-special" onClick={onStop}><StopIcon /> Stop</button>
          ) : (
            <button type="button" className="control-bar-button" onClick={onBack}>&laquo; Back</button>
          )}
        </div>
      </div>

      <div className="sweep-results-subheader">
        <p className="sweep-results-progress">{progressText}</p>
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
        xAxisLabel={xAxisLabel}
        trialFn={trialCompiled.ok ? trialCompiled.evaluate : null}
      />

      <div className="sweep-trial-row">
        <label>
          <span>Trial function f(θ) =</span>
          <input
            type="text"
            value={trialFnText}
            onChange={(e) => setTrialFnText(e.target.value)}
            placeholder={SWEEP_TRIAL_DEFAULT}
          />
        </label>
        <div className="sweep-trial-help-wrap">
          <button
            type="button"
            className="sweep-trial-help-button"
            onClick={() => setHelpOpen((open) => !open)}
            aria-label="Trial function syntax help"
          >
            ?
          </button>
          {helpOpen && (
            <div className="sweep-trial-help-popover">
              <button type="button" className="sweep-trial-help-close" onClick={() => setHelpOpen(false)} aria-label="Close help">×</button>
              <p><strong>θ</strong> (typed as <code>theta</code>) is the swept angle, in degrees.</p>
              <p>Operators: <code>+ - * / ^</code></p>
              <p>Functions: <code>sin cos tan sqrt abs exp ln log</code></p>
              <p>Constants: <code>pi e</code></p>
              <p>Example: <code>100*cos(theta)+5</code></p>
            </div>
          )}
        </div>
      </div>
      {trialFnText.trim() && !trialCompiled.ok && (
        <div className="sweep-trial-error-row">{trialCompiled.error}</div>
      )}

      <div className="sweep-manual-row">
        <button type="button" className="control-bar-button" disabled={running} onClick={onTakeManualPoint}>
          Take data at current settings ({currentValue.toFixed(1)}°)
        </button>
        <button type="button" className="control-bar-button" disabled={sweepState.points.length === 0 || running} onClick={handleSaveCsv}>
          Save Data (CSV)
        </button>
      </div>
    </div>
  );
}
