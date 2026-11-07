// Tests of the frame player (src/playback.js), with stand-ins for the
// workers and the clock: requests are answered when a test says so, and
// time moves only when a test moves it. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FramePlayer, FPS_CHOICES } from '../src/playback.js';

// A player whose `workers` answer requests only when told to (answer), each
// frame saying it took `ms` to trace; and a clock moved by `wait`. step()
// is one animation frame: answers that have come in are taken in, the
// clock moves on 1/60 s, and the player ticks.
function harness({ workers = 4, ms = 20, autoAnswer = true } = {}) {
  let clock = 0;
  const requests = [];
  const player = new FramePlayer({
    workers,
    now: () => clock,
    compute: (time) => new Promise((resolve) => requests.push({ time, resolve })),
  });
  const answer = (count = Infinity) => {
    while (count-- > 0 && requests.length > 0) {
      const r = requests.shift();
      r.resolve({ time: r.time, ms });
    }
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const step = async (playing = true) => {
    if (autoAnswer) answer();
    await settle();
    clock += 1000 / 60;
    return player.tick(playing);
  };
  return { player, requests, answer, settle, step, wait: (ms2) => { clock += ms2; }, now: () => clock };
}

test('with workers that keep up: plays at 30 fps, in real time, the lines in step with the moment shown', async (t) => {
  const h = harness({ workers: 4, ms: 20 });
  h.player.reset({ time: 0, end: 10, speed: 1, key: 'a' });
  let state;
  for (let i = 0; i < 60 * 3; i++) {
    state = await h.step();
    // The frame shown is always the moment shown's own.
    if (state.frame) assert.equal(state.frame.time, state.time);
  }
  t.diagnostic(`after 3 s: t = ${state.time.toFixed(3)} s at ${h.player.fps} fps`);
  assert.equal(h.player.fps, FPS_CHOICES[0]);
  // A short delay to start -- while half a second of frames is traced, four
  // at a time, a few animation frames' worth -- and then real time.
  assert.ok(state.time >= 2.85 && state.time <= 3, `t = ${state.time}`);
  assert.equal(state.calculating, false);
});

test('with slow workers: chooses a slower rate that they can keep up with', async (t) => {
  // 2 workers at 90 ms a frame make 22 frames a second: 25 fps would be
  // too many, with room to spare; 20 isn't.
  const h = harness({ workers: 2, ms: 90 });
  h.player.reset({ time: 0, end: 10, speed: 1, key: 'a' });
  for (let i = 0; i < 30; i++) await h.step();
  t.diagnostic(`chose ${h.player.fps} fps`);
  assert.equal(h.player.fps, 20);
  // Each frame is now 1/20 s of the run after the last.
  let previous = null;
  for (let i = 0; i < 60; i++) {
    const { time } = await h.step();
    if (previous !== null && time !== previous) assert.ok(Math.abs(time - previous - 0.05) < 1e-9);
    previous = time;
  }
});

test('waits for late frames, says so after a moment, and then carries on without rushing', async () => {
  const h = harness({ workers: 1, ms: 20, autoAnswer: false });
  h.player.reset({ time: 0, end: 10, speed: 1, key: 'a' });
  // Fill the start buffer, one frame at a time, and start.
  let state;
  for (let i = 0; i < 40; i++) {
    h.answer(1);
    state = await h.step();
  }
  const before = state.time;
  assert.ok(before > 0);
  // Now nothing more comes in for half a second: the moment holds (the
  // buffer runs out first), and after a while it's "Calculating…".
  for (let i = 0; i < 60; i++) state = await h.step();
  const stalled = state.time;
  for (let i = 0; i < 10; i++) state = await h.step();
  assert.equal(state.time, stalled);
  assert.equal(state.calculating, true);
  // Frames come in again: it carries on one frame at a time.
  h.answer();
  await h.settle();
  const times = [];
  for (let i = 0; i < 6; i++) {
    h.answer();
    times.push((await h.step()).time);
  }
  const advances = times.map((tm, i) => (i === 0 ? tm - stalled : tm - times[i - 1])).filter((d) => d > 1e-12);
  for (const d of advances) assert.ok(Math.abs(d - 1 / 30) < 1e-9, `jumped ${d}`);
});

test('stops exactly at the end of the run', async () => {
  const h = harness();
  h.player.reset({ time: 0, end: 0.5, speed: 1, key: 'a' });
  let state;
  for (let i = 0; i < 120; i++) state = await h.step();
  assert.equal(state.time, 0.5);
  assert.equal(state.ended, true);
});

test('at 2x speed, frames are twice as far apart in the run', async () => {
  const h = harness();
  h.player.reset({ time: 0, end: 10, speed: 2, key: 'a' });
  for (let i = 0; i < 20; i++) await h.step();
  const a = (await h.step()).time;
  let b = a;
  while (b === a) b = (await h.step()).time;
  assert.ok(Math.abs(b - a - 2 / 30) < 1e-9);
});

test('a reset (a scrub) starts over at the new moment, and answers for the old ones are ignored', async () => {
  const h = harness({ autoAnswer: false });
  h.player.reset({ time: 0, end: 10, speed: 1, key: 'a' });
  h.player.tick(false); // asks for the first frames
  const old = h.requests.splice(0);
  h.player.reset({ time: 4, end: 10, speed: 1, key: 'a' });
  const state = h.player.tick(false);
  assert.equal(state.time, 4);
  assert.equal(h.requests[0].time, 4); // the moment shown is asked for first
  old.forEach((r) => r.resolve({ time: r.time, ms: 20 }));
  h.answer();
  await h.settle();
  const after = h.player.tick(false);
  assert.equal(after.frame.time, 4);
});

test('new settings (a new key): the old frame is no longer shown', async () => {
  const h = harness();
  h.player.reset({ time: 0, end: 10, speed: 1, key: 'a' });
  await h.step(false);
  assert.ok((await h.step(false)).frame);
  h.player.reset({ time: 0, end: 10, speed: 1, key: 'b' });
  assert.equal(h.player.tick(false).frame, null);
});

test('a page that can only draw 10 times a second still plays in real time, showing fewer frames', async (t) => {
  const h = harness({ workers: 4, ms: 20 });
  h.player.reset({ time: 0, end: 10, speed: 1, key: 'a' });
  const times = [];
  for (let i = 0; i < 30; i++) {
    h.answer();
    await h.settle();
    h.wait(100); // an animation frame only every 100 ms
    times.push(h.player.tick(true).time);
  }
  // Once it's going (the start buffer takes about half a second to fill,
  // here), 2 s of drawing shows 2 s of the run.
  const gone = times[29] - times[9];
  t.diagnostic(`over 2 s of drawing 10 times a second: ${gone.toFixed(3)} s of the run`);
  assert.ok(Math.abs(gone - 2) < 0.05, `went ${gone} s`);
});

test('workers are given their next frame as soon as they finish one, not just when the page draws', async (t) => {
  // One worker, 20 ms a frame: 5 frames between draws 100 ms apart -- if
  // it's kept busy. Asked only at each draw, it would make 10 a second, too
  // few for 30 fps.
  const h = harness({ workers: 1, ms: 20, autoAnswer: false });
  h.player.reset({ time: 0, end: 10, speed: 1, key: 'a' });
  const times = [];
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 5; j++) {
      h.answer(1);
      await h.settle();
    }
    h.wait(100);
    times.push(h.player.tick(true).time);
  }
  const gone = times[39] - times[19];
  t.diagnostic(`over 2 s: ${gone.toFixed(3)} s of the run, at ${h.player.fps} fps`);
  assert.ok(Math.abs(gone - 2) < 0.05, `went ${gone} s`);
});

test('if frames are slow to come back (a busy page), a slower rate, however fast the workers', async (t) => {
  // Workers that take 20 ms, but whose answers the page takes in only every
  // 100 ms: with 2 requests out at once, 20 frames a second arrive, not
  // the 100 the workers could make.
  let clock = 0;
  const requests = [];
  const player = new FramePlayer({ workers: 2, now: () => clock, compute: (time) => new Promise((resolve) => requests.push({ time, resolve })) });
  player.reset({ time: 0, end: 10, speed: 1, key: 'a' });
  for (let i = 0; i < 60; i++) {
    if (i % 6 === 0) requests.splice(0).forEach((r) => r.resolve({ time: r.time, ms: 20 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock += 1000 / 60;
    player.tick(true);
  }
  player.reset({ time: player.tick(true).time, end: 10, speed: 1, key: 'a' }); // the rate is chosen again on a restart
  t.diagnostic(`chose ${player.fps} fps`);
  assert.equal(player.fps, 20);
});
