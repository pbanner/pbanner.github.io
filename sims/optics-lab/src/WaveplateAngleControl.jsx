import { useRef, useEffect, useState } from 'react';

// Layout -- all tunable
const RULER_WIDTH = 66;
const RULER_HEIGHT = 210;
const PX_PER_DEGREE = 6;         // vertical drag distance, and tick spacing, per degree
const MINOR_TICK_STEP = 2;       // degrees between small (unlabeled) ticks
const MAJOR_TICK_STEP = 10;      // degrees between big, labeled ticks
const MINOR_TICK_LENGTH = 8;     // px the small ticks reach in from the ruler's right edge
const MAJOR_TICK_LENGTH = 16;
const TICK_COLOR = '#333333';
const POINTER_COLOR = '#8b0000'; // same dark red as the rotate button, marking "the current value" the same way that marks "rotate"
const POINTER_LENGTH = 20;       // px the fixed left-side pointer reaches in from the ruler's left edge
const BG_TOP = '#eaf3fc';
const BG_BOTTOM = '#cfe4f7';
const BORDER_COLOR = '#333333';
const CARD_PADDING = 8; // matches .waveplate-angle-control's own padding

// Distance from this control's own top edge down to the ruler's vertical
// center. LabPanel positions this whole control by that center point (it's
// meant to line up with the selected component's own vertical center), but
// the readout row below the ruler adds extra height that isn't mirrored
// above it -- centering the *whole* control there (e.g. a plain CSS
// translateY(-50%)) would leave the ruler itself sitting above that point,
// not on it. Counter-offsetting by exactly this instead keeps the ruler's
// center pinned to the anchor regardless of how tall the rest of the
// control ends up being.
const RULER_CENTER_OFFSET = CARD_PADDING + RULER_HEIGHT / 2;

// Keeps a dragged/typed angle in [0, 360) -- the fast axis can be set to
// anything and spun past 0/360 freely (see the drag handler below), but is
// always displayed/stored as one canonical value in that range.
function wrapDegrees(deg) {
  return ((deg % 360) + 360) % 360;
}

// A vertical ruler the user can drag like an actual rotation-mount dial
// (see the on-canvas indicator this pairs with in LabPanel), plus a numeric
// readout that's both the accessible alternative to dragging and a precise
// way to enter a value directly. Shown next to a selected wave plate --
// see LabPanel's selectedComp block for how it's positioned and wired up.
//
// The ruler itself never physically moves -- there's no DOM element being
// dragged. Instead it's redrawn fresh on every angle change: the tick mark
// for the *current* angle always sits at the canvas's own vertical center,
// where the fixed left-side pointer is, and every other tick is drawn
// relative to that (its y position is just (its degree value - the current
// angle) * PX_PER_DEGREE away from center) -- so changing the angle reads
// as the tape scrolling past a fixed pointer, the way a real dial would,
// without any actual scrolling/translation happening.
//
// onSweepClick is optional -- passing it renders a "Sweep Angle..." button
// to the left of the numeric readout, LabPanel's own entry point into the
// sweep spec modal (see App.jsx's sweepState). Left off entirely (as
// opposed to just hidden)
// while a sweep is already active, rather than disabled, since "click to
// configure another sweep" isn't a meaningful action to dangle in front of
// someone mid-run.
export default function WaveplateAngleControl({ angle, onChangeAngle, onSweepClick }) {
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartAngleRef = useRef(0);

  // The textbox's own display value tracks `angle` normally, but while the
  // user is actively typing in it, their in-progress keystrokes shouldn't
  // get clobbered by that sync (e.g. typing "18" would otherwise get
  // reformatted mid-keystroke once the "1" alone commits nothing new) --
  // computed directly rather than synced via an effect, so there's no
  // separate "did angle change externally" case to reconcile.
  const [editing, setEditing] = useState(false);
  const [textValue, setTextValue] = useState('');
  const displayValue = editing ? textValue : angle.toFixed(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = RULER_WIDTH * dpr;
    canvas.height = RULER_HEIGHT * dpr;
    canvas.style.width = `${RULER_WIDTH}px`;
    canvas.style.height = `${RULER_HEIGHT}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const gradient = ctx.createLinearGradient(0, 0, 0, RULER_HEIGHT);
    gradient.addColorStop(0, BG_TOP);
    gradient.addColorStop(1, BG_BOTTOM);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, RULER_WIDTH, RULER_HEIGHT);

    const centerY = RULER_HEIGHT / 2;
    const visibleHalfRange = centerY / PX_PER_DEGREE;
    const firstTick = Math.ceil((angle - visibleHalfRange) / MINOR_TICK_STEP) * MINOR_TICK_STEP;
    const lastTick = Math.floor((angle + visibleHalfRange) / MINOR_TICK_STEP) * MINOR_TICK_STEP;

    ctx.font = '11px Arial';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let tickDeg = firstTick; tickDeg <= lastTick; tickDeg += MINOR_TICK_STEP) {
      const y = centerY - (tickDeg - angle) * PX_PER_DEGREE;
      const isMajor = Math.round(tickDeg) % MAJOR_TICK_STEP === 0;
      ctx.strokeStyle = TICK_COLOR;
      ctx.lineWidth = isMajor ? 1.5 : 1;
      const length = isMajor ? MAJOR_TICK_LENGTH : MINOR_TICK_LENGTH;
      ctx.beginPath();
      ctx.moveTo(RULER_WIDTH, y);
      ctx.lineTo(RULER_WIDTH - length, y);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = TICK_COLOR;
        ctx.fillText(`${Math.round(wrapDegrees(tickDeg))}°`, RULER_WIDTH - length - 4, y);
      }
    }

    // Fixed pointer -- always at the canvas's own vertical center, marking
    // "this is the current value," regardless of how the tape above has
    // scrolled to place its matching tick there.
    ctx.strokeStyle = POINTER_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(POINTER_LENGTH, centerY);
    ctx.stroke();

    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, RULER_WIDTH - 2, RULER_HEIGHT - 2);
  }, [angle]);

  // Pointer events (not mouse events) so this drags equally well with a
  // finger or Apple Pencil on a touchscreen, not just an actual mouse --
  // Safari doesn't reliably synthesize a live stream of mousemove events
  // from a touch/pen drag, especially over a <canvas>, so a mouse-only
  // implementation here silently never moves on an iPad. preventDefault on
  // the initial pointerdown (backed by the ruler's own touch-action: none
  // in App.css) stops the page itself from scrolling/panning underneath
  // the gesture.
  const handleRulerPointerDown = (e) => {
    e.preventDefault();
    draggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartAngleRef.current = angle;
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      // Dragging up increases the angle (like pulling a vertical slider's
      // handle "up" for "more"), dragging down decreases it. Snapped to the
      // nearest half degree -- dragging is a coarse, by-eye motion, so
      // matching it to whatever fractional pixel the cursor lands on would
      // read as arbitrary precision it doesn't actually have; typing a
      // value directly (see commitText below) is the precise path, and
      // isn't limited to this step.
      const dy = e.clientY - dragStartYRef.current;
      const next = wrapDegrees(dragStartAngleRef.current + dy / PX_PER_DEGREE);
      onChangeAngle(Math.round(next * 2) / 2);
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [onChangeAngle]);

  const commitText = (raw) => {
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed)) onChangeAngle(Math.round(wrapDegrees(parsed) * 10) / 10);
  };

  return (
    <div className="waveplate-angle-control" style={{ transform: `translateY(-${RULER_CENTER_OFFSET}px)` }}>
      <canvas
        ref={canvasRef}
        className="waveplate-angle-ruler"
        onPointerDown={handleRulerPointerDown}
      />
      <div className="waveplate-angle-readout-row">
        {onSweepClick && (
          <button type="button" className="control-bar-button sweep-angle-button" onClick={onSweepClick} title="Sweep this wave plate's angle">
            Sweep Angle…
          </button>
        )}
        <input
          type="number"
          step="0.1"
          className="waveplate-angle-readout"
          value={displayValue}
          onFocus={() => { setTextValue(angle.toFixed(1)); setEditing(true); }}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={() => { setEditing(false); commitText(textValue); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span style={{ fontSize: '18px' }}>°</span>
      </div>
    </div>
  );
}
