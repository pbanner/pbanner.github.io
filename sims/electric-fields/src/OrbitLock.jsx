// Wraps controls that are disabled while the camera orbits (`locked`):
// they're made inert -- nothing in them can be clicked, hovered, focused
// or typed into -- and dimmed. The wrapper has no box of its own (see
// .orbit-lock in App.css), so it must sit inside the element that gives
// the controls their box -- the sidebar, or a panel stack -- which then
// catches presses on them instead of letting them through to the view.
export default function OrbitLock({ locked, children }) {
  return (
    <div className="orbit-lock" inert={locked}>
      {children}
    </div>
  );
}
