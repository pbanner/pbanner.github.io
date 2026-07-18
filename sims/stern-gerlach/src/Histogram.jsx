import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PC_COLORS } from './colors';

// Plot layout -- all tunable
const PADDING_TOP = 44;
const PADDING_RIGHT = 44;    // room for the y-axis tick labels, which sit to the right of the axis
const PADDING_BOTTOM = 16;
const PADDING_LEFT = 12;
const AXIS_COLOR = '#303030';
const TICK_LABEL_COLOR = '#606060';
const MIN_AXIS_MAX = 20;     // the y-axis never scales down below this, even with 0 or few counts
const TARGET_TICK_COUNT = 5; // aim for roughly this many ticks; niceTicks may land on slightly more/fewer
const BAR_GAP_RATIO = 0.3;   // fraction of each bar's horizontal slot left empty as a gap

// Every PC currently placed in the experiment, in a stable left-to-right
// order (by SG index, then up before down) -- this is what turns into one
// bar each.
function getDetectors(experiment) {
  const detectors = [];
  experiment.forEach((sg, sgIndex) => {
    ['up', 'down'].forEach((arm) => {
      if (sg[arm]?.type === 'pc') {
        detectors.push({ sgIndex, arm, colorId: sg[arm].colorId, count: sg[arm].data });
      }
    });
  });
  return detectors;
}

// Picks a "nice" tick step -- 1, 2, or 5 times a power of 10 -- so the axis
// relabels itself cleanly as the largest count grows, rather than ever
// showing an arbitrary tick value like "37". Returns ticks from 0 up to
// (at least) maxValue; the last tick is the axis's effective top.
function niceTicks(maxValue, targetCount) {
  const roughStep = maxValue / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude; // in [1, 10)
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = niceNormalized * magnitude;

  const ticks = [];
  for (let v = 0; v <= maxValue + step * 0.5; v += step) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

export default function Histogram({ experiment }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 300, height: 200 });

  // Resize -- same devicePixelRatio handling as LabPanel's canvas (see the
  // comment there for why), but using a ResizeObserver rather than a
  // window 'resize' listener: this panel's width can change purely from
  // flex layout (e.g. the "Set Measurement Bases" group growing as SGs are
  // added) without the window itself ever resizing, which a 'resize'
  // listener wouldn't catch.
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

    const plotX0 = PADDING_LEFT;
    const plotX1 = width - PADDING_RIGHT;
    const plotY0 = PADDING_TOP;
    const plotY1 = height - PADDING_BOTTOM;

    const detectors = getDetectors(experiment);
    const dataMax = detectors.reduce((m, d) => Math.max(m, d.count), 0);
    const flooredMax = Math.max(MIN_AXIS_MAX, dataMax);
    const ticks = niceTicks(flooredMax, TARGET_TICK_COUNT);
    const axisMax = ticks[ticks.length - 1];

    // Axes -- meet at the bottom-right corner; no gridlines crossing
    // through the bars, just short tick marks off the y-axis.
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotX1, plotY0);
    ctx.lineTo(plotX1, plotY1);
    ctx.lineTo(plotX0, plotY1);
    ctx.stroke();

    // Y-axis ticks + labels
    ctx.fillStyle = TICK_LABEL_COLOR;
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ticks.forEach((tickValue) => {
      const y = plotY1 - (tickValue / axisMax) * (plotY1 - plotY0);
      ctx.beginPath();
      ctx.moveTo(plotX1, y);
      ctx.lineTo(plotX1 + 5, y);
      ctx.stroke();
      ctx.fillText(String(tickValue), plotX1 + 8, y);
    });

    // Bars, one per detector, evenly spaced left to right, growing up from
    // the x-axis, colored to match that detector's own identifying dot.
    if (detectors.length > 0) {
      const slotWidth = (plotX1 - plotX0) / detectors.length;
      const barWidth = slotWidth * (1 - BAR_GAP_RATIO);

      detectors.forEach((d, i) => {
        const barHeight = (d.count / axisMax) * (plotY1 - plotY0);
        const barX = plotX0 + i * slotWidth + (slotWidth - barWidth) / 2;
        const barY = plotY1 - barHeight;

        ctx.fillStyle = PC_COLORS[d.colorId] ?? '#999999';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        if (d.count > 0) {
          ctx.fillStyle = AXIS_COLOR;
          ctx.font = '11px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(String(d.count), barX + barWidth / 2, barY - 2);
        }
      });
    }
  }, [experiment, canvasDims]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawHistogram(canvas.getContext('2d'));
  }, [drawHistogram]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
