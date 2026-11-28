import type { ParseResult } from '../model/types';
import { MAX_BYTES, parseText, readText } from './index';

// A small pool of parsing workers, so several files are read at the same time.
interface PoolWorker { w: Worker; busy: number }
const pool: PoolWorker[] = [];
let nextId = 1;
const pending = new Map<number, { done: (r: ParseResult) => void; worker: PoolWorker; file: string }>();

function poolSize(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(4, cores - 1));
}

/**
 * A worker that failed (it crashed, or sent a message that couldn't be read):
 * each file it was reading counts as unreadable, and it leaves the pool, so
 * the next file gets a fresh worker.
 */
function retire(pw: PoolWorker) {
  const at = pool.indexOf(pw);
  if (at < 0) return;
  pool.splice(at, 1);
  pw.w.terminate();
  for (const [id, job] of pending) {
    if (job.worker !== pw) continue;
    pending.delete(id);
    job.done({ ok: false, file: job.file, error: 'unreadable' });
  }
}

/** The least busy worker, adding one to the pool while it is below its size. */
function pickWorker(): PoolWorker | null {
  if (typeof Worker === 'undefined') return null;
  let best = pool.reduce<PoolWorker | null>((a, b) => (!a || b.busy < a.busy ? b : a), null);
  if ((!best || best.busy > 0) && pool.length < poolSize()) {
    try {
      const pw: PoolWorker = { w: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), busy: 0 };
      pw.w.addEventListener('message', (e: MessageEvent<{ id: number; res: ParseResult }>) => {
        const job = pending.get(e.data.id);
        if (!job) return;
        pending.delete(e.data.id);
        job.worker.busy--;
        job.done(e.data.res);
      });
      pw.w.addEventListener('error', () => retire(pw));
      pw.w.addEventListener('messageerror', () => retire(pw));
      pool.push(pw);
      best = pw;
    } catch {
      return best;
    }
  }
  return best;
}

/**
 * Parses one file in a worker, or on this thread where workers aren't
 * available. Either way it always resolves: a file that can't be read, or
 * that the reader fails on, is 'unreadable', and the other files still load.
 */
export function parseFile(file: File): Promise<ParseResult> {
  const pw = pickWorker();
  if (!pw) {
    if (file.size > MAX_BYTES) return Promise.resolve({ ok: false, file: file.name, error: 'tooBig' });
    return readText(file)
      .then((t) => parseText(t, file.name, file.size))
      .catch((): ParseResult => ({ ok: false, file: file.name, error: 'unreadable' }));
  }
  const id = nextId++;
  pw.busy++;
  return new Promise((resolve) => {
    pending.set(id, { done: resolve, worker: pw, file: file.name });
    pw.w.postMessage({ id, file });
  });
}
