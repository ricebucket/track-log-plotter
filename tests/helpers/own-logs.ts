// Your own logs, for extra checks when you run the tests on your computer.
//
// Put track logs in local-tracks/ (git ignores that folder, so they are never
// committed) and `npm test` and `npm run test:e2e` also read every one of them
// with the app's own code. On GitHub the folder doesn't exist and these checks
// skip themselves.
//
// Tests that use these files report file names and counts only, never a
// coordinate, so nothing from your logs ends up in test output.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './fixtures';

export const LOCAL_DIR = join(ROOT, 'local-tracks');

/** Every file in local-tracks/ and its subfolders, except archives and system files. */
export function localLogs(dir = LOCAL_DIR, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === '__MACOSX' || /\.(zip|7z|rar|gz|tar)$/i.test(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) localLogs(p, out);
    else out.push(p);
  }
  return out;
}

/** A log's name as shown in test titles: its path inside local-tracks/. */
export const localName = (path: string) => relative(LOCAL_DIR, path);
