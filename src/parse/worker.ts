// Parses files off the main thread, so a large log never freezes the page.
import { MAX_BYTES, parseText, readText, transferables } from './index';
import type { ParseResult } from '../model/types';

interface Job { id: number; file: File }

const post = (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage.bind(self);

self.addEventListener('message', async (e: MessageEvent<Job>) => {
  const { id, file } = e.data;
  let res: ParseResult;
  try {
    if (file.size > MAX_BYTES) res = { ok: false, file: file.name, error: 'tooBig' };
    else res = parseText(await readText(file), file.name, file.size);
  } catch {
    res = { ok: false, file: file.name, error: 'unreadable' };
  }
  try {
    post({ id, res }, transferables(res));
  } catch {
    // A result that can't be sent (something in it can't be copied): the file counts as unreadable.
    post({ id, res: { ok: false, file: file.name, error: 'unreadable' } }, []);
  }
});
