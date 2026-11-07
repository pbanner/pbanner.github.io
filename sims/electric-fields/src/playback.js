// Playing a run (motion.js) back: the speeds it can be played at, how
// times are shown, and the frame player that keeps the field lines in step
// with the charges. Plain JS, no React.

// Multiples of real time.
export const SPEEDS = [0.25, 0.5, 1, 2, 4];

// A time in seconds, as the playback panel and its notes show it.
export const formatTime = (t) => `${t.toFixed(2)} s`;

// The frame player. While the field lines change as the charges move, each
// moment's lines take 15-30 ms to trace -- too long to trace on the page
// itself for every frame -- so workers trace them (fieldLineWorkers.js),
// and playback shows a moment only once its lines are ready: the lines and
// the charges stay in step ("lockstep"), at a steady FPS_CHOICES rate.
//
// The moments are a grid of times from where playing (re)started, the
// anchor: frame k is at anchor + k * speed / fps, up to the run's end (the
// last frame is exactly at the end). The player keeps BUFFER_SECONDS of
// frames ahead of the one shown being traced, and before playing starts,
// waits for START_SECONDS of them; then it moves on a frame every 1 / fps
// seconds -- but only to a frame that's ready. If the next one isn't, it
// waits for it, and says so once it's been waiting CALCULATING_DELAY ms
// ("Calculating…"); so workers too slow to keep up make it pause now and
// then, rather than skip moments, and after a pause it carries on from
// there, with no rushing to catch up. (A page that can't even draw that
// often -- its animation frames come further apart than the frames are --
// is another matter: it shows whichever frame is due when it does draw,
// so playback keeps to real time; the frames between were never going to
// be seen on it anyway. Only after a gap longer than MAX_CATCH_UP ms --
// a hidden tab, say -- does it carry on from where it was instead.)
//
// The rate is the best of FPS_CHOICES that can be kept up with, with
// HEADROOM to spare. How many frames a second can be had is the fewer of
// two (each from an average): how many the workers trace -- workers / how
// long a frame takes to trace -- and how many reach the page -- requests
// out at once / how long one takes from asking to getting the answer, a
// round trip that's longer while the page is too busy drawing to take the
// answers in. It's chosen whenever playing restarts, and the very first
// time -- with no frames traced yet to go by -- once the first few have
// been.
//
// The player knows nothing of what a frame is: compute(time) gives a
// promise of the frame for that moment, as { ms, ... } (ms: how long it
// took to trace). now() is the clock, in ms. Both are passed in, so the
// player can be tested with stand-ins for them. `workers` is how many
// workers trace frames (what the rate depends on); `inFlight`, how many
// requests it keeps out at once (more than one a worker keeps each one
// busy back to back: fieldLineWorkers.js).
export const FPS_CHOICES = [30, 25, 20];
const BUFFER_SECONDS = 1;
const START_SECONDS = 0.5;
const HEADROOM = 0.9;
const CALCULATING_DELAY = 150;
const MAX_CATCH_UP = 500;

export class FramePlayer {
  constructor({ compute, workers, inFlight = workers, now, onCancel = () => {} }) {
    this.compute = compute;
    this.workers = workers;
    this.inFlight = inFlight;
    this.now = now;
    this.onCancel = onCancel; // called when waiting requests stop mattering
    this.msPerFrame = null; // how long a frame takes to trace, on average
    this.msPerTrip = null; // and from asking for it to getting it
    this.generation = 0; // bumped on every reset; older answers are ignored
    this.key = null;
    this.shown = null; // the last frame shown, to keep showing until the next
  }

  // Starts over from `time` -- for a new run, a scrub, a new speed, or new
  // settings (a new `key`: frames for an old key are never shown). A frame
  // already traced for exactly `time`, for the same key, is kept: every
  // grid starts with it.
  reset({ time, end, speed, key }) {
    const keep = key === this.key ? this.frames?.get(this.k) : undefined;
    const keepIt = keep && this.timeOf?.(this.k) === time;
    this.generation++;
    this.onCancel();
    this.key = key;
    this.end = end;
    this.speed = speed;
    this.anchor = Math.min(time, end);
    this.fps = this.chooseFps();
    // Until a frame has been traced, the rate is a guess, to be checked.
    this.fpsSettled = this.msPerFrame !== null;
    this.k = 0;
    this.frames = new Map();
    this.pending = new Set();
    if (keepIt) this.frames.set(0, keep);
    if (key !== this.shownKey) this.shown = null;
    this.started = false;
    this.lastAdvance = null;
    this.late = false; // the next frame was due, and isn't ready yet
    this.waitingSince = null;
  }

  chooseFps() {
    if (this.msPerFrame === null) return FPS_CHOICES[0];
    const perSecond = Math.min((this.workers * 1000) / this.msPerFrame, (this.inFlight * 1000) / this.msPerTrip);
    return FPS_CHOICES.find((fps) => fps <= HEADROOM * perSecond) ?? FPS_CHOICES.at(-1);
  }

  timeOf(k) {
    return Math.min(this.anchor + (k * this.speed) / this.fps, this.end);
  }

  lastIndex() {
    return Math.max(0, Math.ceil(((this.end - this.anchor) * this.fps) / this.speed - 1e-9));
  }

  request(k) {
    const generation = this.generation;
    const asked = this.now();
    this.pending.add(k);
    this.compute(this.timeOf(k)).then((frame) => {
      if (generation !== this.generation) return;
      this.pending.delete(k);
      this.frames.set(k, frame);
      const trip = this.now() - asked;
      this.msPerFrame = this.msPerFrame === null ? frame.ms : 0.8 * this.msPerFrame + 0.2 * frame.ms;
      this.msPerTrip = this.msPerTrip === null ? trip : 0.8 * this.msPerTrip + 0.2 * trip;
      // Straight on to the next frame needed: a worker kept waiting for the
      // page's next animation frame would sit idle for most of it on a page
      // that draws slowly.
      this.fill();
    });
  }

  // Keeps the workers busy with the frames needed next, the shown one first,
  // as far ahead as the buffer goes.
  fill() {
    const last = this.lastIndex();
    const ahead = Math.ceil(this.fps * BUFFER_SECONDS);
    for (let j = this.k; j <= Math.min(last, this.k + ahead) && this.pending.size < this.inFlight; j++) {
      if (!this.frames.has(j) && !this.pending.has(j)) this.request(j);
    }
  }

  // Called every animation frame. `playing`: whether playback should move
  // on. Returns what to show: { time, frame, calculating, ended } -- the
  // moment shown, its frame (or the last one shown, until it's ready, or
  // null), whether playback has been waiting for frames long enough to
  // say so, and whether the run's last frame is the one shown.
  tick(playing) {
    const now = this.now();
    const last = this.lastIndex();

    // The first time, check the guessed rate once a few frames are in:
    // if it's too fast for these workers, start over at a slower one,
    // keeping the frame shown (it's at the anchor, on every grid).
    if (!this.fpsSettled && !this.started && this.msPerFrame !== null && this.frames.size >= Math.min(this.workers, 3)) {
      this.fpsSettled = true;
      const fps = this.chooseFps();
      if (fps !== this.fps) {
        const first = this.frames.get(0);
        this.reset({ time: this.anchor, end: this.end, speed: this.speed, key: this.key });
        this.fps = fps;
        this.fpsSettled = true;
        if (first) this.frames.set(0, first);
      }
    }

    this.fill();
    for (const j of this.frames.keys()) if (j < this.k) this.frames.delete(j);

    let waiting = !this.frames.has(this.k);
    if (!playing) {
      this.started = false;
      this.late = false;
    } else if (!waiting && !this.started) {
      // Before starting: enough frames ahead, or every one to the end.
      const needed = Math.min(last, this.k + Math.ceil(this.fps * START_SECONDS));
      let ready = true;
      for (let j = this.k + 1; j <= needed; j++) if (!this.frames.has(j)) ready = false;
      if (ready) {
        this.started = true;
        this.lastAdvance = now;
      } else {
        waiting = true;
      }
    } else if (!waiting && this.k < last) {
      const interval = 1000 / this.fps;
      const due = Math.floor((now - this.lastAdvance) / interval);
      if (this.late || now - this.lastAdvance > MAX_CATCH_UP) {
        // After waiting for the next frame (or a long gap, like a hidden
        // tab): on to it as soon as it's ready, timed from then.
        if (this.frames.has(this.k + 1)) {
          this.k++;
          this.lastAdvance = now;
          this.late = false;
        } else {
          this.late = true;
          waiting = true;
        }
      } else if (due > 0) {
        // On time: as many frames on as are due (usually one), as far as
        // they're ready.
        let advanced = 0;
        while (advanced < due && this.k < last && this.frames.has(this.k + 1)) {
          this.k++;
          advanced++;
        }
        this.lastAdvance += advanced * interval;
        if (advanced < due && this.k < last) {
          this.late = true;
          waiting = true;
        }
      }
    }

    if (waiting) this.waitingSince ??= now;
    else this.waitingSince = null;
    const frame = this.frames.get(this.k);
    if (frame) {
      this.shown = frame;
      this.shownKey = this.key;
    }
    return {
      time: this.timeOf(this.k),
      frame: this.shown,
      calculating: waiting && now - this.waitingSince >= CALCULATING_DELAY,
      ended: this.k >= last,
    };
  }
}
