import { useRef } from 'react';

// A number box with up and down arrows -- used in place of
// <input type="number">, with the same props. Safari on an iPad or iPhone
// doesn't draw a number box's own arrows at all, so they're hidden (see
// .number-input in App.css) and these are drawn instead, the same on every
// device.
//
// An arrow steps the box just as the browser's own arrows would -- the
// box's stepUp() or stepDown(), which keep to its min, max and step -- and
// then fires the same input event, so the box's onChange handles it
// exactly as it would a step with the browser's arrows. (A change made that
// way has no inputType, nor does a step with the up or down key; typing,
// pasting and deleting do. A box that saves what's typed only once it's
// finished uses that to save a step at once.)
//
// A `width` in `style` is the box and its arrows together, so a layout
// doesn't shift; the box takes what the arrows leave.
export default function NumberInput({ style, ...inputProps }) {
  const inputRef = useRef(null);
  const step = (direction) => {
    const input = inputRef.current;
    if (!input || input.disabled || input.readOnly) return;
    try {
      if (direction > 0) input.stepUp();
      else input.stepDown();
    } catch {
      return; // step="any", or nothing to step from
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const { width, ...inputStyle } = style ?? {};
  return (
    <span className="number-input" style={width === undefined ? undefined : { width }}>
      <input ref={inputRef} type="number" {...inputProps} style={inputStyle} />
      {/* Left out of the Tab order: the up and down keys step a focused
          box. */}
      <span className="number-input-arrows">
        {[[1, 'Increase'], [-1, 'Decrease']].map(([direction, action]) => (
          <button key={direction} type="button" tabIndex={-1} aria-label={action} disabled={inputProps.disabled} onClick={() => step(direction)}>
            <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true" style={{ display: 'block', transform: direction > 0 ? undefined : 'rotate(180deg)' }}>
              <path d="M0 5 4 0 8 5Z" fill="currentColor" />
            </svg>
          </button>
        ))}
      </span>
    </span>
  );
}
