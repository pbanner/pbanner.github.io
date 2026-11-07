// The playback controls, along the bottom edge above the usage hint: Play
// (Pause while playing, Replay once the run is over), Reset, the time,
// a scrubber across the whole run, and the speed. Shown while there's at
// least one free charge. Purely presentational: App.jsx keeps the
// playback state, and motion.js works out the run.
//
// run: the run (motion.js's simulateRun), or null if it can't be made.
// playback: { status, time, speed } -- status 'setup' (before a run:
//   everything can be edited), 'playing', 'paused' or 'ended' (the run has
//   reached its end) -- time in seconds, speed a multiple of real time.
// onPlay() / onPause() / onReset() / onScrub(time) / onSpeed(speed).
// playBlockedReason: why the run can't be played, as Play's tooltip
//   (Play is grayed out), or null.
// note: what ended the run ("q₁ hit a point charge at t = 1.30 s"), shown
//   once the run has reached its end, or null.
// calculating: whether the field lines for the next moment are still
//   being worked out, and playback is waiting for them.
import Segmented from './Segmented.jsx';
import { SPEEDS, formatTime } from './playback.js';

const SPEED_LABELS = { 0.25: '¼×', 0.5: '½×', 1: '1×', 2: '2×', 4: '4×' };
// The scrubber's resolution, in seconds.
const SCRUB_STEP = 0.01;

export default function PlaybackPanel({ run, playback, onPlay, onPause, onReset, onScrub, onSpeed, playBlockedReason = null, note = null, calculating = false }) {
  const { status, time, speed } = playback;
  const end = run?.end.time ?? 0;
  const canPlay = !!run && end > 0 && !playBlockedReason;
  let playLabel = 'Play';
  if (status === 'playing') playLabel = 'Pause';
  else if (status === 'ended') playLabel = 'Replay';
  return (
    <div className="overlay-controls playback-panel">
      <div className="playback-row">
        <button
          type="button"
          className="control-button playback-button"
          disabled={status !== 'playing' && !canPlay}
          title={canPlay ? undefined : playBlockedReason ?? undefined}
          onClick={status === 'playing' ? onPause : onPlay}
        >
          {playLabel}
        </button>
        <button type="button" className="control-button playback-button" disabled={status === 'setup'} onClick={onReset}>
          Reset
        </button>
        <span className="playback-time">t = {formatTime(time)}</span>
        <input
          className="playback-scrubber"
          type="range"
          aria-label="Time"
          min={0}
          max={end}
          step={SCRUB_STEP}
          value={time}
          disabled={!canPlay && status === 'setup'}
          onChange={(e) => onScrub(Number(e.target.value))}
        />
        <Segmented options={SPEEDS.map((s) => [s, SPEED_LABELS[s]])} value={speed} onChange={onSpeed} />
      </div>
      {(note || calculating) && (
        <div className="playback-note">{calculating ? 'Calculating…' : note}</div>
      )}
    </div>
  );
}
