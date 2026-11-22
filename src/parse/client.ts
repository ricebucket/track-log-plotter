import type { ParseResult } from '../model/types';
import { MAX_BYTES, parseText } from './index';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: ParseResult) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<{ id: number; res: ParseResult }>) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      done?.(e.data.res);
    });
    return worker;
  } catch {
    return null;
  }
}

/** Parses one file in the worker, or on this thread where workers aren't available. */
export function parseFile(file: File): Promise<ParseResult> {
  const w = getWorker();
  if (!w) {
    if (file.size > MAX_BYTES) return Promise.resolve({ ok: false, file: file.name, error: 'tooBig' });
    return file.text().then((t) => parseText(t, file.name, file.size), () => ({ ok: false, file: file.name, error: 'unreadable' }));
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, file });
  });
}
