import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PC_COLORS } from './colors';

// Plot layout -- all tunable
const PADDING_TOP = 25;
const PADDING_RIGHT = 12;    // room for the y-axis tick labels, which sit to the right of the axis
const PADDING_BOTTOM = 16;
const PADDING_LEFT = 40;
const AXIS_COLOR = '#303030';
const AXIS_HEADROOM = 1.1;   // require the top tick to clear the tallest bar by this factor, so bars never crowd the very top and rescaling kicks in a bit before a bar would actually exceed the old top tick
const TICK_LABEL_COLOR = '#606060';
const MIN_AXIS_MAX = 20;     // the y-axis never scales down below this, even with 0 or few counts
const TARGET_TICK_COUNT = 5; // aim for roughly this many ticks; niceTicks may land on slightly more/fewer
const BAR_GAP_RATIO = 0.3;   // fraction of each bar's horizontal slot left empty as a gap
const BAR_GROUP_MARGIN = 24; // extra empty space to each side of the whole set of bars, beyond the axis padding
const MAX_BAR_WIDTH = 60;    // a bar never grows wider than this, however few detectors there are
const ERROR_BAR_WIDTH_RATIO = 0.4;
const ERROR_BAR_WIDTH_MIN = 20;
const LEGEND_WIDTH = 120;
const LEGEND_GAP = 14;
const LEGEND_PADDING = 8;
const LEGEND_SWATCH_SIZE = 12;
const LEGEND_ROW_HEIGHT = 18;
const TOTAL_COLOR = '#303030';

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

export default function Histogram({ experiment, displayBools }) {
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

    const detectors = getDetectors(experiment);
    const dataTotal = detectors.reduce((sum, d) => sum + d.count, 0);
    const dataMax = detectors.reduce((m, d) => Math.max(m, d.count), 0);
    const requiredMax = Math.max(MIN_AXIS_MAX, dataMax * AXIS_HEADROOM);
    const ticks = niceTicks(requiredMax, TARGET_TICK_COUNT);
    const axisMax = ticks[ticks.length - 1];

    const legendOn = displayBools.showLegend;
    const legendX1 = width - PADDING_RIGHT;
    const legendX0 = legendX1 - LEGEND_WIDTH;
    const legendBoxHeight = LEGEND_PADDING * 2 + Math.max(detectors.length, 1) * LEGEND_ROW_HEIGHT;

    const plotX0 = PADDING_LEFT;
    const plotX1 = legendOn ? legendX0 - LEGEND_GAP : width - PADDING_RIGHT;
    const plotY0 = PADDING_TOP;
    const plotY1 = height - PADDING_BOTTOM;

    // Axes -- meet at the bottom-right corner; no gridlines crossing
    // through the bars, just short tick marks off the y-axis.
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotX0, plotY0);
    ctx.lineTo(plotX0, plotY1);
    ctx.lineTo(plotX1, plotY1);
    ctx.stroke();

    // Y-axis ticks + labels
    ctx.fillStyle = TICK_LABEL_COLOR;
    ctx.font = '11px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ticks.forEach((tickValue) => {
      const y = plotY1 - (tickValue / axisMax) * (plotY1 - plotY0);
      ctx.beginPath();
      ctx.moveTo(plotX0 - 5, y);
      ctx.lineTo(plotX0 + 5, y);
      ctx.stroke();
      ctx.fillText(String(tickValue), plotX0 - 8, y);
    });

    // Bars, one per detector, evenly spaced left to right, growing up from
    // the x-axis, colored to match that detector's own identifying dot.
    if (detectors.length > 0) {
      const groupX0 = plotX0 + BAR_GROUP_MARGIN;
      const groupX1 = plotX1 - BAR_GROUP_MARGIN;
      const slotWidth = (groupX1 - groupX0) / detectors.length;
      const barWidth = Math.min(MAX_BAR_WIDTH, slotWidth * (1 - BAR_GAP_RATIO));

      detectors.forEach((d, i) => {
        const barHeight = Math.max(1.5, (d.count / axisMax) * (plotY1 - plotY0));
        const slotCenter = groupX0 + (i + 0.5) * slotWidth;
        const barX = slotCenter - barWidth / 2;
        const barY = plotY1 - barHeight;

        ctx.fillStyle = PC_COLORS[d.colorId] ?? '#999999';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        const drawErrorBars = (d.count > 2 && displayBools.showErrorBars);
        const errOffset = Math.sqrt(d.count)*(barHeight/d.count);
        if (drawErrorBars) {
          const halfErrorBarWidth = Math.min(barWidth*ERROR_BAR_WIDTH_RATIO, ERROR_BAR_WIDTH_MIN)/2;
          ctx.strokeStyle = AXIS_COLOR;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(slotCenter - halfErrorBarWidth, barY - errOffset);
          ctx.lineTo(slotCenter + halfErrorBarWidth, barY - errOffset);
          ctx.moveTo(slotCenter, barY - errOffset);
          ctx.lineTo(slotCenter, barY + errOffset);
          ctx.moveTo(slotCenter - halfErrorBarWidth, barY + errOffset);
          ctx.lineTo(slotCenter + halfErrorBarWidth, barY + errOffset);
          ctx.stroke();
        }

        const showBothActual = (displayBools.showPercentages === 2 && dataTotal > 0);
        ctx.fillStyle = PC_COLORS[d.colorId];
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const barLabel = ((displayBools.showPercentages === 1 && dataTotal === 0) ? "---" : "") + (displayBools.showPercentages !== 1 ? String(d.count) : "") + (showBothActual ? " (" : "") + ((displayBools.showPercentages !== 0 && dataTotal !== 0) ? (d.count/dataTotal*100).toFixed(1) + "%" : "") + (showBothActual ? ")" : "");
        ctx.fillText(barLabel, barX + barWidth / 2, barY - 4 - (drawErrorBars ? errOffset : 0));
      });
    }

    if (legendOn) {
      const legendY0 = plotY0;
      const legendY1 = legendY0 + legendBoxHeight;
      ctx.strokeStyle = "#999999";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(legendX0, legendY0, LEGEND_WIDTH, legendY1 - legendY0, 5);
      ctx.stroke()
      ctx.font = '11px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (detectors.length === 0) {
        ctx.fillStyle = TICK_LABEL_COLOR;
        ctx.fillText('No detectors', legendX0 + LEGEND_PADDING, legendY0 + legendBoxHeight / 2);
      } else {
        detectors.forEach((d, i) => {
          const rowY = legendY0 + LEGEND_PADDING + i * LEGEND_ROW_HEIGHT + LEGEND_ROW_HEIGHT / 2;
          ctx.fillStyle = PC_COLORS[d.colorId] ?? '#999999';
          ctx.fillRect(legendX0 + LEGEND_PADDING, rowY - LEGEND_SWATCH_SIZE / 2, LEGEND_SWATCH_SIZE, LEGEND_SWATCH_SIZE);
          ctx.fillStyle = AXIS_COLOR;
          ctx.fillText(`SG${d.sgIndex + 1} ${d.arm}`, legendX0 + LEGEND_PADDING + LEGEND_SWATCH_SIZE + 6, rowY);
        });
      }
    }

    if (displayBools.showTotal) {
      ctx.fillStyle = TOTAL_COLOR;
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`N = ${dataTotal}`, (plotX0 + plotX1)/2, PADDING_TOP / 2);
    }
  }, [experiment, displayBools, canvasDims]);

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
