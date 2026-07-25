import React, { useRef, useEffect, useState, useCallback } from 'react';
import { theoreticalProbabilities } from './physics';
import { PC_COLORS } from './colors';

// Plot layout -- all tunable
const PADDING_TOP = 25;
const PADDING_RIGHT = 12;    // room for the y-axis tick labels, which sit to the right of the axis
const PADDING_BOTTOM = 20;
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
const LEGEND_WIDTH = 100;
const LEGEND_GAP = 14;
const LEGEND_PADDING = 8;
const LEGEND_SWATCH_SIZE = 12;
const LEGEND_ROW_HEIGHT = 18;
const TOTAL_COLOR = '#303030';
const THEORY_LINE_COLOR = '#707070';
const THEORY_LINE_WIDTH = 2;
//const THEORY_LINE_DASH = [4, 3];
const THEORY_LINE_OVERHANG = 6; // extra px each side beyond the bar's own width, so the line reads as "wider than the bar" rather than flush with its edges

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

    const rawDetectors = getDetectors(experiment);
    const dataTotal = rawDetectors.reduce((sum, d) => sum + d.count, 0);

    // Theoretical probabilities are computed exactly (see physics.js), not
    // sampled -- converted to an expected *count* by scaling against the
    // same dataTotal the observed bars are drawn against, so the reference
    // line is a fair comparison against however much data has actually
    // been collected so far.
    //
    // theoreticalProbabilities() is normalized against the *entire* oven
    // ensemble, including particles that never reach a placed PC at all
    // (absorbed by a beam block, or run off the end of the chain
    // unmeasured) -- but dataTotal only ever counts particles that landed
    // in a placed PC, since that's all the histogram can see. Comparing
    // raw theoryProb against that would make the reference lines too low
    // (and not sum to dataTotal) any time a BB or an open end siphons off
    // some fraction of the particles, so it's renormalized here to sum to
    // 1 across just the placed PCs, matching what dataTotal actually
    // represents.
    const theoryOn = displayBools.showTheory;
    const theoryMap = theoryOn
      ? (() => {
          const theoryList = theoreticalProbabilities(experiment);
          const theorySum = theoryList.reduce((s, t) => s + t.prob, 0);
          return new Map(theoryList.map((t) => [`${t.sgIndex}-${t.arm}`, theorySum > 0 ? t.prob / theorySum : 0]));
        })()
      : null;
    const detectors = rawDetectors.map((d) => ({
      ...d,
      theoryProb: theoryMap ? (theoryMap.get(`${d.sgIndex}-${d.arm}`) ?? 0) : 0,
    }));

    // The axis has to be tall enough for the theory lines too, not just the
    // observed bars, or a line for an under-sampled detector could get
    // clipped off the top of the plot.
    const dataMax = detectors.reduce((m, d) => {
      const expected = theoryOn && dataTotal > 0 ? d.theoryProb * dataTotal : 0;
      return Math.max(m, d.count, expected);
    }, 0);
    const requiredMax = Math.max(MIN_AXIS_MAX, dataMax * AXIS_HEADROOM);
    const ticks = niceTicks(requiredMax, TARGET_TICK_COUNT);
    const axisMax = ticks[ticks.length - 1];

    const legendOn = displayBools.showLegend;
    const legendX1 = width - PADDING_RIGHT;
    const legendX0 = legendX1 - LEGEND_WIDTH;
    const legendRowCount = detectors.length === 0 ? 1 : detectors.length + (theoryOn ? 1 : 0);
    const legendBoxHeight = LEGEND_PADDING * 2 + legendRowCount * LEGEND_ROW_HEIGHT;

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

        // Bars, one per detector, growing up from the x-axis, colored to match
    // that detector's own identifying dot. Bars belonging to the same SG
    // sit flush against each other with no gap; a gap is inserted only
    // where the SG changes. The whole set of (possibly grouped) bars is
    // then centered as one cluster within the plot's bar area.
    if (detectors.length > 0) {
      const groupX0 = plotX0 + BAR_GROUP_MARGIN;
      const groupX1 = plotX1 - BAR_GROUP_MARGIN;
      const slotWidth = (groupX1 - groupX0) / detectors.length;
      const barWidth = Math.min(MAX_BAR_WIDTH, slotWidth * (1 - BAR_GAP_RATIO));
      const sgGapWidth = slotWidth * BAR_GAP_RATIO;
      const sgGroupCount = new Set(detectors.map((d) => d.sgIndex)).size;
      const clusterWidth = detectors.length * barWidth + (sgGroupCount - 1) * sgGapWidth;
      const clusterStart = groupX0 + (groupX1 - groupX0 - clusterWidth) / 2;

      let cursor = clusterStart;
      detectors.forEach((d, i) => {
        if (i > 0 && d.sgIndex !== detectors[i - 1].sgIndex) {
          cursor += sgGapWidth;
        }
        const barX = cursor;
        const slotCenter = barX + barWidth / 2;
        cursor += barWidth;

        const barHeight = Math.max(1.5, (d.count / axisMax) * (plotY1 - plotY0));
        const barY = plotY1 - barHeight;

        ctx.fillStyle = PC_COLORS[d.colorId] ?? '#999999';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // Draw the error bars
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

        // Draw the theory reference lines
        if (theoryOn && dataTotal > 0) {
          const expectedCount = d.theoryProb * dataTotal;
          const lineY = plotY1 - (expectedCount / axisMax) * (plotY1 - plotY0);
          const lineHalfWidth = barWidth / 2 + THEORY_LINE_OVERHANG;
          ctx.strokeStyle = THEORY_LINE_COLOR;
          ctx.lineWidth = THEORY_LINE_WIDTH;
          //ctx.setLineDash(THEORY_LINE_DASH);
          ctx.beginPath();
          ctx.moveTo(slotCenter - lineHalfWidth, lineY);
          ctx.lineTo(slotCenter + lineHalfWidth, lineY);
          ctx.stroke();
          //ctx.setLineDash([]);
        }

        // Write the labels on all the bars
        const showBothActual = (displayBools.showPercentages === 2 && dataTotal > 0);
        ctx.fillStyle = PC_COLORS[d.colorId];
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const barLabel = ((displayBools.showPercentages === 1 && dataTotal === 0) ? "---" : "") + (displayBools.showPercentages !== 1 ? String(d.count) : "") + (showBothActual ? " (" : "") + ((displayBools.showPercentages !== 0 && dataTotal !== 0) ? (d.count/dataTotal*100).toFixed(1) + "%" : "") + (showBothActual ? ")" : "");
        // Wider counts push their "(xx.x%)" half further out, so a fixed
        // offset that clears a 3-digit count starts clashing again once
        // counts hit 4+ digits -- scale it up by 3px per digit beyond 3.
        const labelOffsetMagnitude = 3 * Math.max(1, String(d.count).length - 2);
        const barLabelXOffset = (!showBothActual || detectors.length < 2) ? 0 : ((i > 0 && d.sgIndex === detectors[i - 1].sgIndex) ? labelOffsetMagnitude : (i < detectors.length - 1 && d.sgIndex === detectors[i + 1].sgIndex ? -labelOffsetMagnitude : 0));
        ctx.fillText(barLabel, barX + barWidth / 2 + barLabelXOffset, barY - 4 - (drawErrorBars ? errOffset : 0));

        // Detector label below the bar, in the same style as the axis's own tick labels
        ctx.fillStyle = TICK_LABEL_COLOR;
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`SG${d.sgIndex + 1}` + (d.arm == 'up' ? '↑' : '↓'), slotCenter, plotY1 + 6);
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
        // Add the theory line at the end
        if (theoryOn) {
          const rowY = legendY0 + LEGEND_PADDING + detectors.length * LEGEND_ROW_HEIGHT + LEGEND_ROW_HEIGHT / 2;
          ctx.strokeStyle = THEORY_LINE_COLOR;
          ctx.lineWidth = THEORY_LINE_WIDTH;
          //ctx.setLineDash(THEORY_LINE_DASH);
          ctx.beginPath();
          ctx.moveTo(legendX0 + LEGEND_PADDING, rowY);
          ctx.lineTo(legendX0 + LEGEND_PADDING + LEGEND_SWATCH_SIZE, rowY);
          ctx.stroke();
          //ctx.setLineDash([]);
          ctx.fillStyle = AXIS_COLOR;
          ctx.fillText('Theoretical', legendX0 + LEGEND_PADDING + LEGEND_SWATCH_SIZE + 6, rowY);
        }
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
