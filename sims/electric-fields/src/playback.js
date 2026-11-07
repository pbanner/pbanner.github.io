// Playing a run (motion.js) back: the speeds it can be played at, and how
// times are shown. Plain JS, no React.

// Multiples of real time.
export const SPEEDS = [0.25, 0.5, 1, 2, 4];

// A time in seconds, as the playback panel and its notes show it.
export const formatTime = (t) => `${t.toFixed(2)} s`;
