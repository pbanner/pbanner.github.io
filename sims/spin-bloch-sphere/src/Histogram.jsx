import { useRef, useEffect, useState, useCallback } from 'react';
import { ketWidth, drawKet } from './ket.js';
import './App.css';

// A small, fixed two-bar histogram for the data-collection mode's
// projective measurement results, drawn on a canvas as an actual labeled
// graph -- a horizontal count-zero axis with arrowheads at both ends, a
// vertical counts axis through the center with an upward arrowhead and
// auto-scaled ticks (same "nice round numbers" approach as the
// Stern-Gerlach sim's histogram), and the two bars flanking that center
// axis. Deliberately not the general N-detector version from that sim,
// since here there are always exactly two outcomes and no interactivity
// (hover, magnifier, legend) is needed.

const PADDING_TOP = 30;      // room for the "Counts" axis label and its arrowhead
const PADDING_BOTTOM = 34;   // room for each bar's ket label below the zero axis
const PADDING_SIDE = 14;     // room for the horizontal axis's arrowheads
const CENTER_GAP = 10;       // gap between the vertical axis and each bar's inner edge -- wide enough that a tick's number, and a bar's own count label overhanging past the bar's edge, both clear each other
const BAR_WIDTH_RATIO = 0.40; // fraction of each half-slot's remaining width (outside the center gap) a bar fills
const ARROW_SIZE = 7;        // px, axis arrowhead size
const AXIS_HEADROOM = 1.25;  // the scale's top tick clears the tallest bar (or theory line) by this factor, leaving room for both bars' count labels above them
const MIN_AXIS_MAX = 5;      // the counts axis never scales down below this, even with 0 or 1 counts
const TARGET_TICK_COUNT = 4; // aim for roughly this many ticks; niceTicks may land on slightly more/fewer

const AXIS_COLOR = '#333333';
const BAR_COLOR = '#5a5a5a';  // deliberately neutral gray, not blue/red -- those already mean the field/spin arrows elsewhere in the scene
const TICK_LABEL_COLOR = '#606060';
const THEORY_LINE_COLOR = '#8a8a8a';
const LABEL_COLOR = '#333333';

// Picks a "nice" tick step -- 1, 2, or 5 times a power of 10 -- so the axis
// relabels itself cleanly as counts grow, rather than showing an arbitrary
// value like "37". Same routine as the Stern-Gerlach histogram's. Returns
// ticks from 0 up to (at least) minTop; the last tick is the axis's top.
function niceTicks(minTop, targetCount) {
  const roughStep = minTop / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = niceNormalized * magnitude;
  const topTick = Math.ceil(minTop / step) * step;

  const ticks = [];
  for (let v = 0; v <= topTick + step * 0.5; v += step) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

// A filled triangular arrowhead with its tip at (x, y), pointing the given
// direction -- vector-drawn (like ket.js's bracket) rather than a Unicode
// arrow, so it renders identically everywhere.
function drawArrowhead(ctx, x, y, size, direction) {
  const rot = direction === 'left' ? Math.PI : direction === 'up' ? -Math.PI / 2 : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.55);
  ctx.lineTo(-size, -size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export default function Histogram({ axisLabel, counts, showTheory, setShowTheory, theoryProbPlus, onClear }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 300, height: 170 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = newWidth * dpr;
      canvas.height = newHeight * dpr;
      canvas.style.width = `${newWidth}px`;
      canvas.style.height = `${newHeight}px`;
      canvas.getContext('2d').scale(dpr, dpr);

      setCanvasDims({ width: newWidth, height: newHeight });
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const drawHistogram = useCallback((ctx) => {
    const { width, height } = canvasDims;
    ctx.clearRect(0, 0, width, height);

    const total = counts.plus + counts.minus;
    const theoryPlusCount = theoryProbPlus * total;
    const theoryMinusCount = total - theoryPlusCount;
    const dataMax = Math.max(
      counts.plus, counts.minus,
      showTheory ? theoryPlusCount : 0,
      showTheory ? theoryMinusCount : 0,
    );
    const requiredMax = Math.max(MIN_AXIS_MAX, dataMax * AXIS_HEADROOM);
    const ticks = niceTicks(requiredMax, TARGET_TICK_COUNT);
    const axisMax = ticks[ticks.length - 1];

    const plotY1 = height - PADDING_BOTTOM;                 // zero axis
    const plotY0 = PADDING_TOP + ARROW_SIZE;                 // where axisMax's tick sits
    const plotX0 = PADDING_SIDE;
    const plotX1 = width - PADDING_SIDE;
    const centerX = width / 2;
    const yForCount = (c) => plotY1 - (c / axisMax) * (plotY1 - plotY0);

    // Horizontal (zero) axis, arrowheads at both ends
    ctx.strokeStyle = AXIS_COLOR;
    ctx.fillStyle = AXIS_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotX0, plotY1);
    ctx.lineTo(plotX1, plotY1);
    ctx.stroke();
    drawArrowhead(ctx, plotX0, plotY1, ARROW_SIZE, 'left');
    drawArrowhead(ctx, plotX1, plotY1, ARROW_SIZE, 'right');

    // Vertical (counts) axis through the center, upward arrowhead
    const axisTopY = plotY0 - ARROW_SIZE;
    ctx.beginPath();
    ctx.moveTo(centerX, plotY1);
    ctx.lineTo(centerX, axisTopY);
    ctx.stroke();
    drawArrowhead(ctx, centerX, axisTopY, ARROW_SIZE, 'up');

    // Ticks -- a short dash across the counts axis plus its value, skipping
    // 0 since the horizontal axis already marks it.
    ctx.font = '10px Arial';
    ctx.fillStyle = TICK_LABEL_COLOR;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ticks.forEach((v) => {
      if (v === 0) return;
      const y = yForCount(v);
      ctx.strokeStyle = AXIS_COLOR;
      ctx.beginPath();
      ctx.moveTo(centerX - 4, y);
      ctx.lineTo(centerX + 4, y);
      ctx.stroke();
      //ctx.fillText(String(v), centerX + 7, y);
    });

    // Axis label, just under the arrowhead
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Counts', centerX, axisTopY - 2);

    // Bars, one to each side of the counts axis -- each centered within its
    // own half-slot (the space between the center gap and the plot's outer
    // edge), so widening CENTER_GAP for the tick labels never pushes a bar
    // off-center or past plotX0/plotX1.
    const slotWidth = centerX - CENTER_GAP - plotX0;
    const barWidth = slotWidth * BAR_WIDTH_RATIO;
    const barMargin = (slotWidth - barWidth) / 2;
    const barX = {
      plus: plotX0 + barMargin,
      minus: centerX + CENTER_GAP + barMargin,
    };
    const theoryCountOf = { plus: theoryPlusCount, minus: theoryMinusCount };
    const signOf = { plus: '+', minus: '-' };

    ['plus', 'minus'].forEach((key) => {
      const x = barX[key];
      const count = counts[key];
      const barY = yForCount(count);

      ctx.fillStyle = BAR_COLOR;
      ctx.fillRect(x, barY, barWidth, plotY1 - barY);

      if (showTheory && total > 0) {
        const ty = yForCount(theoryCountOf[key]);
        ctx.strokeStyle = THEORY_LINE_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x - 4, ty);
        ctx.lineTo(x + barWidth + 4, ty);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Count / percentage label above the bar -- AXIS_HEADROOM guarantees
      // this has clearance even when the bar is the tallest thing shown.
      const pct = total > 0 ? (count / total) * 100 : 0;
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label = total > 0 ? `${count} (${pct.toFixed(0)}%)` : `${count}`;
      ctx.fillText(label, x + barWidth / 2, barY - 4);

      // Ket label below the zero axis, drawn with ket.js so its bracket
      // shares the exact same vertical geometry as every other ket in the
      // scene, rather than relying on font metrics.
      const ketSize = 15;
      const kWidth = ketWidth(ketSize);
      const subPx = ketSize * 0.55;
      ctx.font = `bold ${subPx}px sans-serif`;
      const subWidth = ctx.measureText(axisLabel).width;
      const gap = ketSize * 0.06;
      const totalWidth = kWidth + gap + subWidth;
      const startX = x + barWidth / 2 - totalWidth / 2.5;
      const midY = plotY1 + PADDING_BOTTOM * 0.5;
      ctx.fillStyle = LABEL_COLOR;
      drawKet(ctx, startX, midY, ketSize, signOf[key]);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(axisLabel, startX + kWidth + gap, midY + ketSize * 0.40);
    });
  }, [canvasDims, counts, showTheory, theoryProbPlus, axisLabel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawHistogram(canvas.getContext('2d'));
  }, [drawHistogram]);

  const total = counts.plus + counts.minus;

  return (
    <div className="overlay-controls">
      <h3 style={{ textAlign: 'center' }}>Data Histogram</h3>
      <span style={{ fontSize: '0.85rem', color: '#333', textAlign: 'center', fontWeight: 'bold' }}>Total N = {total}</span>
      <div ref={containerRef} style={{ width: '100%', height: '170px' }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
      <div className="control-group" style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
        <button className={`control-button ${showTheory ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setShowTheory(!showTheory)}>
          Show theory
        </button>
        <button className="control-button" onClick={onClear} style={{ flex: 1 }} disabled={total === 0}>
          Clear Data
        </button>
        </div>
    </div>
  );
}