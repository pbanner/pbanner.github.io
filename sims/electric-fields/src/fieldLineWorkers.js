// A pool of field-line workers (fieldLineWorker.js): `count` of them, each
// tracing one moment's lines at a time. Each is sent up to SLOTS requests
// at once -- the second waits in the worker's own queue, so it starts the
// moment the first is done, even while the page is too busy drawing to
// send it anything new -- and any more requests wait here, for a worker
// with a slot free. Browser only (Node has no Web Workers in this form);
// the frame player (playback.js) is what uses it, with `capacity`
// requests at most out at once.
//
// compute(request) sends a request ({ sources, density, want3D, cut }: see
// fieldLineWorker.js) and gives a promise of the worker's answer.
// clearQueue() drops the requests still waiting -- when what they were
// for no longer matters, say after a scrub -- and their promises never
// settle; one already being traced finishes, and is ignored by whoever
// asked. terminate() stops the workers for good.
//
// How many: one fewer than the computer's processor cores (leaving one for
// the page itself), at least 1 and at most MAX_WORKERS.
const MAX_WORKERS = 4;
const SLOTS = 2;
export function workerCount() {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}

export function createFieldLineWorkers(count = workerCount()) {
  // Vite bundles the worker's module from this URL (new URL(...,
  // import.meta.url) is the form it recognizes).
  const workers = Array.from({ length: count }, () => new Worker(new URL('./fieldLineWorker.js', import.meta.url), { type: 'module' }));
  const load = new Map(workers.map((w) => [w, 0])); // requests out to each
  const waiting = [];
  const answers = new Map();
  let nextId = 1;

  const pump = () => {
    while (waiting.length > 0) {
      // The least busy worker, if it has a slot free.
      const worker = workers.reduce((a, b) => (load.get(b) < load.get(a) ? b : a));
      if (load.get(worker) >= SLOTS) return;
      const { request, resolve } = waiting.shift();
      const id = nextId++;
      answers.set(id, resolve);
      load.set(worker, load.get(worker) + 1);
      worker.postMessage({ id, ...request });
    }
  };
  for (const worker of workers) {
    worker.onmessage = (event) => {
      const resolve = answers.get(event.data.id);
      answers.delete(event.data.id);
      load.set(worker, load.get(worker) - 1);
      resolve?.(event.data);
      pump();
    };
  }

  return {
    count,
    capacity: count * SLOTS,
    compute(request) {
      return new Promise((resolve) => {
        waiting.push({ request, resolve });
        pump();
      });
    },
    clearQueue() {
      waiting.length = 0;
    },
    terminate() {
      for (const worker of workers) worker.terminate();
    },
  };
}
