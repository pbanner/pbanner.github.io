import { useRef, useEffect, useState, useCallback } from 'react';
import { PC_COLORS } from './colors.js';

// Plot layout -- all tunable
const PADDING_TOP = 25;
const PADDING_RIGHT = 12;    // room for the y-axis tick labels, which sit to the right of the axis
const PADDING_BOTTOM = 20;
const TICK_LABEL_GAP = 8;   // gap between the axis line and the tick numbers, and between the tick numbers and the "Counts" label past them
const Y_AXIS_LABEL_THICKNESS = 12; // the rotated "Counts" label's own font size -- its horizontal footprint once turned sideways
const Y_AXIS_LABEL_MARGIN = 4; // margin between the "Counts" label and the canvas's own left edge
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
const LEGEND_WIDTH = 60;
const LEGEND_GAP = 14;
const LEGEND_PADDING = 8;
const LEGEND_SWATCH_SIZE = 12;
const LEGEND_ROW_HEIGHT = 18;
const TOTAL_COLOR = '#303030';
const LOUPE_DIAMETER = 200;  // css px, the magnifier's own on-screen size
const LOUPE_ZOOM = 10;        // how much the loupe magnifies the chart underneath the cursor
const LOUPE_INK_SCALE = 1 / LOUPE_ZOOM * 2.0; // shrinks line widths/font sizes before the zoom transform blows them back up, so they render at their normal apparent size instead of getting magnified too
const HOVER_BORDER_COLOR = '#000000';
const HOVER_BORDER_WIDTH = 2.5;
const OPTIONS_TOGGLE_SIZE = 36; // matches .icon-only-button's own height

// Every placed detector, left-to-right in the same placement order LabPanel
// itself numbers them by (see its detectorNumbers map) -- one bar each.
function getDetectors(components) {
  return components
    .filter((c) => c.type === 'detector')
    .map((c, i) => ({ id: c.id, label: `D${i + 1}`, colorId: c.colorId, count: c.count ?? 0 }));
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

export default function Histogram({ components, displayBools, hoverEnabled, hoveredDetectorId, setHoveredDetectorId, optionsCollapsed, onShowOptions }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasDims, setCanvasDims] = useState({ width: 300, height: 200 });

  const [magnifierOn, setMagnifierOn] = useState(false);
  const loupeCanvasRef = useRef(null);
  const loupeWrapperRef = useRef(null);
  // The cursor position (in the same CSS-pixel space as canvasDims) the
  // loupe is currently centered on -- a ref, not state, since mousemove
  // fires far too often to push through React's render cycle.
  const cursorPosRef = useRef(null);

  // Each bar's own hit-box (in the same CSS-pixel space as canvasDims),
  // refreshed every main-canvas draw -- a ref, not state, since it's read
  // only from the mousemove hit-test below, not something the render needs
  // to react to itself.
  const barRectsRef = useRef([]);

  // Resize -- same devicePixelRatio handling as LabPanel's canvas (see the
  // comment there for why), but using a ResizeObserver rather than a
  // window 'resize' listener: this panel's width can change purely from
  // flex layout without the window itself ever resizing, which a 'resize'
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

  // inkScale lets this same drawing routine be reused, unmodified, to render
  // into the magnifier loupe: the loupe applies a zoom transform to its own
  // context before calling this, so every position (bar heights, gaps, tick
  // spacing) comes out magnified for free -- but stroke widths and font
  // sizes would get magnified right along with them unless divided down by
  // that same zoom factor first, which is what inkScale is for. Passing 1
  // (the default) reproduces the exact unmagnified drawing.
  const drawHistogram = useCallback((ctx, inkScale = 1) => {
    const { width, height } = canvasDims;
    ctx.clearRect(0, 0, width, height);

    const detectors = getDetectors(components);
    const dataTotal = detectors.reduce((sum, d) => sum + d.count, 0);
    const dataMax = detectors.reduce((m, d) => Math.max(m, d.count), 0);
    const requiredMax = Math.max(MIN_AXIS_MAX, dataMax * AXIS_HEADROOM);
    const ticks = niceTicks(requiredMax, TARGET_TICK_COUNT);
    const axisMax = ticks[ticks.length - 1];

    // How much horizontal room the tick numbers need changes as the axis
    // rescales (e.g. "20" vs "100000"), so the left padding -- and with it,
    // where the "Counts" label sits -- is measured fresh each draw rather
    // than fixed, keeping the label flush against the tick numbers no
    // matter how wide they get.
    ctx.font = '11px Arial';
    const maxTickLabelWidth = ticks.reduce((w, t) => Math.max(w, ctx.measureText(String(t)).width), 0);
    const paddingLeft = Y_AXIS_LABEL_MARGIN + Y_AXIS_LABEL_THICKNESS + TICK_LABEL_GAP + maxTickLabelWidth + TICK_LABEL_GAP;

    const legendOn = displayBools.showLegend;
    const legendX1 = width - PADDING_RIGHT;
    const legendX0 = legendX1 - LEGEND_WIDTH;
    const legendRowCount = detectors.length === 0 ? 1 : detectors.length;
    const legendBoxHeight = LEGEND_PADDING * 2 + legendRowCount * LEGEND_ROW_HEIGHT;

    const plotX0 = paddingLeft;
    const plotX1 = legendOn ? legendX0 - LEGEND_GAP : width - PADDING_RIGHT;
    const plotY0 = PADDING_TOP;
    const plotY1 = height - PADDING_BOTTOM;

    // Axes -- meet at the bottom-right corner; no gridlines crossing
    // through the bars, just short tick marks off the y-axis.
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1.5 * inkScale;
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
      ctx.fillText(String(tickValue), plotX0 - TICK_LABEL_GAP, y);
    });

    // Y-axis title, rotated to read bottom-to-top and centered against the
    // axis's full height, sitting just past the tick numbers -- paddingLeft
    // above already reserved exactly enough room for this, however wide
    // those numbers turned out to be.
    ctx.save();
    ctx.translate(Y_AXIS_LABEL_MARGIN + Y_AXIS_LABEL_THICKNESS / 2, (plotY0 + plotY1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = TICK_LABEL_COLOR;
    ctx.font = `bold ${Y_AXIS_LABEL_THICKNESS}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Counts', 0, 0);
    ctx.restore();

    // For interactive hovering
    const isMainDraw = inkScale === 1;
    if (isMainDraw) barRectsRef.current = [];
    // Bars, one per detector, growing up from the x-axis, colored to match
    // that detector's own stripe/count color, in placement order, evenly
    // spaced -- unlike the Stern-Gerlach sim's histogram, there's no
    // grouping (that was for an SG's up/down pair sitting flush together),
    // so every bar just gets the same gap on each side.
    if (detectors.length > 0) {
      const groupX0 = plotX0 + BAR_GROUP_MARGIN;
      const groupX1 = plotX1 - BAR_GROUP_MARGIN;
      const slotWidth = (groupX1 - groupX0) / detectors.length;
      const barWidth = Math.min(MAX_BAR_WIDTH, slotWidth * (1 - BAR_GAP_RATIO));
      const gapWidth = slotWidth * BAR_GAP_RATIO;
      const clusterWidth = detectors.length * barWidth + (detectors.length - 1) * gapWidth;
      const clusterStart = groupX0 + (groupX1 - groupX0 - clusterWidth) / 2;

      let cursor = clusterStart;
      detectors.forEach((d, i) => {
        if (i > 0) cursor += gapWidth;
        const barX = cursor;
        const slotCenter = barX + barWidth / 2;
        cursor += barWidth;

        const barHeight = Math.max(1.5, (d.count / axisMax) * (plotY1 - plotY0));
        const barY = plotY1 - barHeight;
        const color = PC_COLORS[d.colorId] ?? '#999999';

        ctx.fillStyle = color;
        ctx.fillRect(barX, barY, barWidth, barHeight);
        if (isMainDraw) barRectsRef.current.push({ id: d.id, x: barX, y: barY, width: barWidth, height: barHeight });
        if (isMainDraw && hoveredDetectorId === d.id) {
          ctx.strokeStyle = HOVER_BORDER_COLOR;
          ctx.lineWidth = HOVER_BORDER_WIDTH * inkScale;
          ctx.strokeRect(barX, barY, barWidth, barHeight);
        }

        // Draw the error bars
        const drawErrorBars = (d.count > 2 && displayBools.showErrorBars);
        const errOffset = Math.sqrt(d.count) * (barHeight / d.count);
        if (drawErrorBars) {
          const halfErrorBarWidth = Math.min(barWidth * ERROR_BAR_WIDTH_RATIO, ERROR_BAR_WIDTH_MIN) / 2;
          ctx.strokeStyle = AXIS_COLOR;
          ctx.lineWidth = 1.5 * inkScale;
          ctx.beginPath();
          ctx.moveTo(slotCenter - halfErrorBarWidth, barY - errOffset);
          ctx.lineTo(slotCenter + halfErrorBarWidth, barY - errOffset);
          ctx.moveTo(slotCenter, barY - errOffset);
          ctx.lineTo(slotCenter, barY + errOffset);
          ctx.moveTo(slotCenter - halfErrorBarWidth, barY + errOffset);
          ctx.lineTo(slotCenter + halfErrorBarWidth, barY + errOffset);
          ctx.stroke();
        }

        // Write the labels on all the bars
        const showBothActual = (displayBools.showPercentages === 2 && dataTotal > 0);
        ctx.fillStyle = color;
        ctx.font = `11px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const barLabel = ((displayBools.showPercentages === 1 && dataTotal === 0) ? "---" : "") + (displayBools.showPercentages !== 1 ? String(d.count) : "") + (showBothActual ? " (" : "") + ((displayBools.showPercentages !== 0 && dataTotal !== 0) ? (d.count/dataTotal*100).toFixed(1) + "%" : "") + (showBothActual ? ")" : "");
        ctx.fillText(barLabel, slotCenter, barY - 4 - (drawErrorBars ? errOffset : 0));

        // Detector label below the bar, in the same style as the axis's own
        // tick labels.
        ctx.fillStyle = TICK_LABEL_COLOR;
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(d.label, slotCenter, plotY1 + 6);
      });
    }

    if (legendOn) {
      const legendY0 = plotY0;
      const legendY1 = legendY0 + legendBoxHeight;
      ctx.strokeStyle = "#999999";
      ctx.lineWidth = 1 * inkScale;
      ctx.beginPath();
      ctx.roundRect(legendX0, legendY0, LEGEND_WIDTH, legendY1 - legendY0, 5);
      ctx.stroke()
      ctx.font = `11px Arial`;
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
          ctx.fillText(d.label, legendX0 + LEGEND_PADDING + LEGEND_SWATCH_SIZE + 6, rowY);
        });
      }
    }

    // Plot title
    ctx.fillStyle = TOTAL_COLOR;
    ctx.font = `bold 14px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Detector Counts' + (displayBools.showTotal ? ` (N = ${dataTotal})` : ''), (plotX0 + plotX1)/2, PADDING_TOP / 2);
  }, [components, displayBools, canvasDims, hoveredDetectorId]);

  // Renders the loupe: re-runs the exact same drawHistogram routine against
  // the loupe's own canvas, but first stacks a translate/scale/translate
  // transform onto it that maps the region of the main chart around the
  // cursor onto the loupe's full (small) area. Because that transform is
  // applied to the context *before* drawHistogram runs, every position it
  // computes (bar heights, gaps, tick spacing) comes out magnified for
  // free -- drawHistogram itself never needs to know it's being magnified,
  // aside from the inkScale passed through to keep line widths/fonts from
  // being magnified right along with everything else.
  const drawLoupe = useCallback(() => {
    const loupeCanvas = loupeCanvasRef.current;
    const cursor = cursorPosRef.current;
    if (!loupeCanvas || !cursor) return;
    const dpr = window.devicePixelRatio || 1;
    const loupeCtx = loupeCanvas.getContext('2d');
    // setTransform (not scale/translate relative to whatever was already
    // there) so each redraw starts from a clean slate instead of compounding
    // onto the previous frame's transform.
    loupeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    loupeCtx.clearRect(0, 0, LOUPE_DIAMETER, LOUPE_DIAMETER);
    loupeCtx.translate(LOUPE_DIAMETER / 2, LOUPE_DIAMETER / 2);
    loupeCtx.scale(LOUPE_ZOOM, LOUPE_ZOOM);
    loupeCtx.translate(-cursor.x, -cursor.y);
    drawHistogram(loupeCtx, LOUPE_INK_SCALE);
  }, [drawHistogram]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawHistogram(canvas.getContext('2d'));
    if (magnifierOn) drawLoupe();
  }, [drawHistogram, magnifierOn, drawLoupe]);

  // Sets up the loupe canvas's own backing resolution whenever it mounts
  // (i.e. whenever the magnifier is toggled on) -- same devicePixelRatio
  // handling as the main canvas's resize effect above.
  useEffect(() => {
    if (!magnifierOn) return;
    const loupeCanvas = loupeCanvasRef.current;
    if (!loupeCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    loupeCanvas.width = LOUPE_DIAMETER * dpr;
    loupeCanvas.height = LOUPE_DIAMETER * dpr;
    loupeCanvas.style.width = `${LOUPE_DIAMETER}px`;
    loupeCanvas.style.height = `${LOUPE_DIAMETER}px`;
  }, [magnifierOn]);

  // Tracks the cursor to see if it's over a bar -- shared with LabPanel (see
  // hoveredDetectorId/setHoveredDetectorId, lifted up to App), so hovering a
  // bar here highlights that detector on the canvas too, the same way
  // hovering the detector on the canvas highlights its bar here (LabPanel's
  // own onMouseEnter/Leave write to the same shared state). hoverEnabled is
  // off while build/remove mode is active, per the user's request.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleMouseMove = (e) => {
      if (magnifierOn || !hoverEnabled) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = barRectsRef.current.find(
        (r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
      );
      setHoveredDetectorId(hit ? hit.id : null);
    };
    const handleMouseLeave = () => {
      if (magnifierOn || !hoverEnabled) return;
      setHoveredDetectorId(null);
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [magnifierOn, hoverEnabled, setHoveredDetectorId]);

  // Tracks the cursor over the main canvas while the magnifier is active,
  // positioning the loupe (via direct style mutation, not React state --
  // mousemove fires far too often to re-render on) and redrawing it live.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = loupeWrapperRef.current;
    if (!canvas || !magnifierOn) return;

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      cursorPosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (wrapper) {
        wrapper.style.left = `${cursorPosRef.current.x - LOUPE_DIAMETER / 2}px`;
        wrapper.style.top = `${cursorPosRef.current.y - LOUPE_DIAMETER / 2}px`;
        wrapper.style.display = 'block';
      }
      drawLoupe();
    };
    const handleMouseLeave = () => {
      cursorPosRef.current = null;
      if (wrapper) wrapper.style.display = 'none';
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [magnifierOn, drawLoupe]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Clipping layer holding the chart and the loupe -- see the Stern-
          Gerlach sim's Histogram for why this is a separate absolutely
          positioned layer (keeps the canvas's fixed pixel width from ever
          ratcheting the panel wider) and why the magnifier button sits
          outside it (so its negative left offset isn't clipped). */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
        {magnifierOn && (
          <div ref={loupeWrapperRef} className="histogram-loupe" style={{ display: 'none' }}>
            <canvas ref={loupeCanvasRef} />
          </div>
        )}
      </div>
      <button
        type="button"
        className={`control-bar-button icon-only-button icon-only-button-square histogram-magnifier-toggle${magnifierOn ? ' active' : ''}`}
        onClick={() => setMagnifierOn((on) => !on)}
        title="Magnify"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.2" y1="16.2" x2="21" y2="21" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      {optionsCollapsed && (
        <button
          type="button"
          className="control-bar-button icon-only-button icon-only-button-square histogram-options-toggle active"
          onClick={onShowOptions}
          title="Show chart options"
          style={{
            // Same horizontal position as the magnifier toggle above (same
            // left offset off this same containerRef) -- vertically,
            // centered on the plot's own bottom axis line, which always
            // sits exactly PADDING_BOTTOM above this container's bottom
            // edge regardless of canvas size or how much data there is.
            bottom: PADDING_BOTTOM - OPTIONS_TOGGLE_SIZE / 2,
          }}
        >
          &lt;&lt;
        </button>
      )}
    </div>
  );
}
