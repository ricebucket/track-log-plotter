// The demo videos in docs/video/, one per language. First one track, a walk in
// Lower Manhattan, then the three loggers of the synthetic Stanford drive
// combined into one track. The browser's frames are captured as they're
// painted (its screencast), encoded as H.264 by the browser itself (WebCodecs)
// and saved as a 1120 × 1680 MP4 (tests/video/mp4.ts): nothing to install.
//
// A recording of the screen shows no pointer, so one is drawn into the page: a
// large arrow, with a ring that spreads where it presses. Red boxes mark what
// to look at, and a caption says what each step shows. The pointer glides by
// the clock, so the demo keeps its pace on a busy machine.
//
// Run with npm run video, and watch the results before committing them.
// DEMO_DRY_RUN=<folder> skips the MP4: it saves the picture on screen every two
// seconds there and lists how long each caption stays up.
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mp4 } from './mp4';
import { combineTracks } from '../../src/combine/combine';
import { load } from '../helpers/fixtures';

type Lang = 'en' | 'zh';
type Messages = Record<string, string | Record<string, string>>;
const MESSAGES: Record<Lang, Messages> = {
  en: JSON.parse(readFileSync('src/i18n/en-US.json', 'utf8')),
  zh: JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf8')),
};
/** The app's text for a key (the "other" form of a plural), with its {placeholders} filled in: what its buttons are named. */
function translate(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  const m = MESSAGES[lang][key] ?? MESSAGES.en[key];
  if (m === undefined) throw new Error(`no text for ${key}`);
  return (typeof m === 'string' ? m : m.other).replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all));
}

const OUT = 'docs/video';
const FIX = 'tests/fixtures';
const SIZE = { width: 1120, height: 1680 };
const FPS = 30;
const LONGEST = 60; // seconds
// The bitrate the H.264 encoder aims for, in bits a second: the most it takes (it refuses 300 Mbit/s), for the best
// picture it gives. DEMO_BITRATE overrides it. Frames that change little take far less, so a file comes out well under it.
const BITRATE = Number(process.env.DEMO_BITRATE) || 240_000_000;
// High profile, at a level that allows the bitrate: 4.0 up to 25 Mbit/s, 4.2 up to 62.5, 5.1 beyond.
const H264 = { codec: BITRATE <= 25e6 ? 'avc1.640028' : BITRATE <= 62.5e6 ? 'avc1.64002a' : 'avc1.640033', bitrate: BITRATE, keyEvery: 2 * FPS };
const STANFORD = ['stanford-drive-car.nmea', 'stanford-drive-phone.gpx', 'stanford-drive-logger.gpx'];

/** What the captions say, and the walk's new name. */
const SAY: Record<Lang, Record<string, string>> = {
  en: {
    intro: 'GPS logs on a map, in your browser',
    open: 'Open a track log from your computer',
    timeline: 'Point at the timeline: the fix card follows on the map',
    play: 'Play it back',
    color: 'Color by elevation, with speed as the halo',
    rename: 'Rename a track',
    properties: 'Properties: the stats and the file’s details',
    basemap: 'Basemaps, from street maps to satellite',
    more: 'Three loggers on one drive: hide the walk, fit the map',
    combine: 'Combine 2 or 3 logs of the same trip',
    closeup: 'Up close, each source shows as a thin line',
    onmap: 'Fixes and direction arrows, on or off',
    trust: 'Trust a source more, and the combined track moves toward it',
    end: 'Your files never leave your computer',
    name: 'Manhattan walk',
  },
  zh: {
    intro: '在浏览器中把 GPS 记录画在地图上',
    open: '打开电脑上的轨迹记录',
    timeline: '指向时间轴：地图上的定位点信息卡随之移动',
    play: '回放轨迹',
    color: '用海拔作为线条颜色，用速度作为光晕',
    rename: '重命名轨迹',
    properties: '属性：统计数据与文件信息',
    basemap: '底图：从街道地图到卫星影像',
    more: '同一次行车的三个记录器：隐藏步行轨迹，缩放到轨迹',
    combine: '合并同一次行程的 2 或 3 条记录',
    closeup: '放大来看，每个来源是一条细线',
    onmap: '定位点和方向箭头，可开可关',
    trust: '更信任某个来源，合并轨迹就向它靠近',
    end: '文件始终只在本机上',
    name: '曼哈顿步行',
  },
};

interface Rect { x: number; y: number; width: number; height: number }

/**
 * Drawn into the page for the recording: the pointer, a large arrow (twice a
 * usual pointer's size) with a ring that spreads and fades around a dot where it
 * presses; red boxes; and the caption. They follow pointer events, not mouse
 * events: the timeline and the trust triangle cancel pointerdown, which stops
 * the mouse events of the press and the drag after it.
 */
function overlay() {
  const add = () => {
    const style = document.createElement('style');
    style.textContent = `
      #demo-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transform: translate(-100px, -100px); }
      .demo-press { position: fixed; z-index: 2147483646; border-radius: 50%; pointer-events: none; transform: scale(0.25); opacity: 1; }
      .demo-box { position: fixed; z-index: 2147483645; border: 4px solid #e0262b; border-radius: 12px; box-shadow: 0 0 0 5px rgba(224, 38, 43, 0.16);
        pointer-events: none; opacity: 0; transform: scale(1.04); transition: opacity 0.4s ease-out, transform 0.4s ease-out; }
      .demo-box.on { opacity: 1; transform: none; }
      #demo-caption { position: fixed; z-index: 2147483644; padding: 14px 22px; border-radius: 16px; background: rgba(16, 24, 32, 0.88); color: #fff;
        font: 700 30px/1.3 system-ui, 'Noto Sans CJK SC', sans-serif; text-align: center; text-wrap: balance; pointer-events: none;
        opacity: 0; transition: opacity 0.3s; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3); }
      #demo-caption.on { opacity: 1; }`;
    document.head.append(style);
    const pointer = Object.assign(document.createElement('div'), { id: 'demo-pointer' });
    pointer.innerHTML = '<svg width="52" height="52" viewBox="0 0 26 26" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))">'
      + '<path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.6 15.2 L18 15.2 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const caption = Object.assign(document.createElement('div'), { id: 'demo-caption' });
    document.documentElement.append(pointer, caption);
    // The arrow's tip, at (3, 2) of its drawing, drawn twice as large.
    addEventListener('pointermove', (e) => { pointer.style.transform = `translate(${e.clientX - 6}px, ${e.clientY - 4}px)`; }, true);
    const press = (e: PointerEvent, size: number, look: string, ms: number, scale: number) => {
      const el = Object.assign(document.createElement('div'), { className: 'demo-press' });
      el.style.cssText = `left:${e.clientX - size / 2}px;top:${e.clientY - size / 2}px;width:${size}px;height:${size}px;${look}`
        + `transition:transform ${ms}ms ease-out,opacity ${ms}ms ease-in;`;
      document.documentElement.append(el);
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transform = `scale(${scale})`; el.style.opacity = '0'; }));
      setTimeout(() => el.remove(), ms + 100);
    };
    addEventListener('pointerdown', (e) => {
      // In the app's blue.
      press(e, 84, 'border:5px solid rgba(47,108,246,.95);background:rgba(47,108,246,.16);', 1000, 1.25);
      press(e, 26, 'background:rgba(47,108,246,.8);', 700, 1);
      // A box goes at the next press, unless it's to stay for the whole step.
      for (const box of document.querySelectorAll('.demo-box:not(.keep)')) box.remove();
    }, true);
    const w = window as unknown as { demoBox: unknown; demoCaption: unknown };
    /** A red box around a part of the page (with room around it), to show where to look. */
    w.demoBox = (r: { x: number; y: number; width: number; height: number }, keep: boolean) => {
      const box = Object.assign(document.createElement('div'), { className: `demo-box${keep ? ' keep' : ''}` });
      Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
      document.documentElement.append(box);
      requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('on')));
    };
    /** The caption for a new step (its boxes go): over the map, at its top between the panel and the basemap button, or at its bottom. */
    w.demoCaption = (text: string, where: 'top' | 'bottom') => {
      for (const box of document.querySelectorAll('.demo-box')) box.remove();
      const panel = document.querySelector('.panel')?.getBoundingClientRect();
      const tools = document.querySelector('.bm-button')?.getBoundingClientRect();
      const timeline = document.querySelector('.timeline')?.getBoundingClientRect();
      const left = panel && panel.right < innerWidth / 2 ? panel.right + 18 : 18;
      const right = where === 'top' && tools ? innerWidth - tools.left + 14 : 18;
      Object.assign(caption.style, where === 'top'
        ? { left: `${left}px`, right: `${right}px`, top: '22px', bottom: '' }
        : { left: `${left}px`, right: `${right}px`, top: '', bottom: `${(timeline ? innerHeight - timeline.top : 0) + 18}px` });
      caption.textContent = text;
      caption.classList.add('on');
    };
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add);
  else add();
}

/** One picture the page painted, from video frame `first` on (frames at FPS from the start). */
interface Shot { first: number; jpeg: Buffer }

/** Records the page's pictures as they're painted; stop() gives each with the video frame it shows from. */
async function record(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const shots = new Map<number, Buffer>(); // of several painted before one video frame, the last
  let start: number | null = null;
  cdp.on('Page.screencastFrame', (f) => {
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    const at = f.metadata.timestamp ?? Date.now() / 1000;
    if (start === null) start = at;
    shots.set(Math.ceil((at - start) * FPS), Buffer.from(f.data, 'base64'));
  });
  // The pictures as JPEG at full quality: the encoder then starts from all the page painted.
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 100, maxWidth: SIZE.width, maxHeight: SIZE.height });
  return {
    async stop(): Promise<{ shots: Shot[]; frames: number }> {
      const end = Date.now() / 1000; // the clock the pictures' times are on
      await cdp.send('Page.stopScreencast');
      const frames = start === null ? 0 : Math.ceil((end - start) * FPS);
      return { shots: [...shots].sort((a, b) => a[0] - b[0]).filter(([n]) => n < frames).map(([first, jpeg]) => ({ first, jpeg })), frames };
    },
  };
}

/**
 * In the encoder's page: an H.264 encoder (WebCodecs), given pictures by
 * `window.picture` and finished by `window.encoded`.
 */
function startEncoder({ width, height, fps, codec, bitrate, keyEvery }: { width: number; height: number; fps: number; codec: string; bitrate: number; keyEvery: number }) {
  const chunks: { data: Uint8Array<ArrayBuffer>; key: boolean; timestamp: number }[] = [];
  let config: VideoDecoderConfig | null = null;
  let failure: string | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig && !config) config = meta.decoderConfig;
      const data = new Uint8Array(new ArrayBuffer(chunk.byteLength));
      chunk.copyTo(data);
      chunks.push({ data, key: chunk.type === 'key', timestamp: chunk.timestamp });
    },
    error: (e) => { failure = String(e); },
  });
  encoder.configure({ codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } });
  const g = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  // A picture as limited-range BT.709 4:2:0, the usual form of HD video. (Given the canvas itself, Chromium
  // encodes full range, which some players show too dark and too bright.)
  const space: VideoColorSpaceInit = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
  const i420 = (rgba: Uint8ClampedArray) => {
    const out = new Uint8ClampedArray((width * height * 3) / 2), u = width * height, v = u + u / 4;
    for (let p = 0, i = 0; p < u; p++, i += 4) out[p] = 16 + 0.18259 * rgba[i] + 0.61423 * rgba[i + 1] + 0.06201 * rgba[i + 2];
    for (let y = 0, q = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2, q++) {
        const i = (y * width + x) * 4, j = i + width * 4;
        const r = (rgba[i] + rgba[i + 4] + rgba[j] + rgba[j + 4]) / 4;
        const gr = (rgba[i + 1] + rgba[i + 5] + rgba[j + 1] + rgba[j + 5]) / 4;
        const b = (rgba[i + 2] + rgba[i + 6] + rgba[j + 2] + rgba[j + 6]) / 4;
        out[u + q] = 128 - 0.10064 * r - 0.33857 * gr + 0.43922 * b;
        out[v + q] = 128 + 0.43922 * r - 0.39894 * gr - 0.04027 * b;
      }
    }
    return out;
  };
  const w = window as unknown as { picture: unknown; encoded: unknown };
  /** A painted picture (a JPEG, in base64), as video frames `first` to `first + count - 1`. */
  w.picture = async (jpeg: string, first: number, count: number) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${jpeg}`)).blob());
    g.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const yuv = i420(g.getImageData(0, 0, width, height).data);
    for (let n = first; n < first + count; n++) {
      const frame = new VideoFrame(yuv, { format: 'I420', codedWidth: width, codedHeight: height, colorSpace: space, timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: n % keyEvery === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise((done) => encoder.addEventListener('dequeue', done, { once: true }));
    }
  };
  /** The encoded frames, in base64, with each one's size, key-frame flag and time. */
  w.encoded = async () => {
    await encoder.flush();
    if (failure) throw new Error(failure);
    const all = new Blob(chunks.map((c) => c.data));
    const data = await new Promise<string>((done) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => done((reader.result as string).slice((reader.result as string).indexOf(',') + 1)));
      reader.readAsDataURL(all);
    });
    const d = (config as VideoDecoderConfig | null)?.description;
    if (!d) throw new Error('the encoder gave no decoder configuration');
    return {
      data, sizes: chunks.map((c) => c.data.length), keys: chunks.map((c) => c.key), times: chunks.map((c) => c.timestamp),
      description: Array.from(ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d)),
    };
  };
}

/** Encodes the pictures as `frames` video frames, each held until the next was painted, and saves them as MP4. */
async function encodeMp4(browser: Browser, shots: Shot[], frames: number, file: string) {
  // WebCodecs needs a secure context, which a file:// page is.
  const dir = mkdtempSync(join(tmpdir(), 'demo-'));
  try {
    writeFileSync(join(dir, 'encoder.html'), '<!doctype html><title>Encoder</title>');
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, 'encoder.html')).href);
    await page.evaluate(startEncoder, { ...SIZE, fps: FPS, ...H264 });
    for (const [i, shot] of shots.entries()) {
      const count = (i + 1 < shots.length ? shots[i + 1].first : frames) - shot.first;
      await page.evaluate(([j, f, c]) => (window as unknown as { picture: (j: string, f: number, c: number) => Promise<void> }).picture(j, f, c), [shot.jpeg.toString('base64'), shot.first, count] as const);
    }
    const out = await page.evaluate(() => (window as unknown as { encoded: () => Promise<{ data: string; sizes: number[]; keys: boolean[]; times: number[]; description: number[] }> }).encoded());
    await page.close();
    // The MP4 file gives every frame the same length and decodes them in the order they are shown, so the
    // encoder must have kept them all, in order.
    if (out.times.length !== frames || out.times.some((t, n) => t !== Math.round((n * 1e6) / FPS))) {
      throw new Error(`the encoder gave ${out.times.length} frames out of order or missing, of ${frames}`);
    }
    const data = Buffer.from(out.data, 'base64');
    let at = 0;
    const samples = out.sizes.map((size, n) => { at += size; return { data: data.subarray(at - size, at), key: out.keys[n] }; });
    writeFileSync(file, mp4({ ...SIZE, timescale: 90_000, sampleDuration: 90_000 / FPS, description: Buffer.from(out.description), samples }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The end of the Stanford drive, on Escondido Road in front of Branner Hall,
 * combined the way the app combines it (the three logs in the list's order,
 * trusted equally): the combined track's time span (the timeline's, once it's
 * the only track shown), its last fix, and where it and each source were over
 * the last `seconds`.
 */
function driveEnd(seconds: number) {
  const r = combineTracks(STANFORD.map((f) => load(f)));
  if (!r.ok) throw new Error(`the Stanford drive did not combine: ${r.reason}`);
  const c = r.track, n = c.cols.n, last = c.cols.t[n - 1];
  const near: [number, number][] = [];
  for (let i = n - 1; i >= 0 && c.cols.t[i] >= last - seconds * 1000; i--) {
    near.push([c.cols.lat[i], c.cols.lon[i]]);
    c.combo.srcLat.forEach((lat, k) => { if (Number.isFinite(lat[i])) near.push([lat[i], c.combo.srcLon[k][i]]); });
  }
  return { t0: c.derived.stats.start, t1: c.derived.stats.end, lat: c.cols.lat[n - 1], lon: c.cols.lon[n - 1], near };
}

/** A place in Web Mercator, as shares of the world's width (x) and height (y). */
function mercator(lat: number, lon: number) {
  return { x: (lon + 180) / 360, y: 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI) };
}

/** Places on screen, from a place whose screen position is known, with the map's zoom read off its scale bar. */
async function onScreen(page: Page, from: { lat: number; lon: number; x: number; y: number }, places: [number, number][], km: string) {
  // The map's metres per pixel give the world's width in pixels at this zoom (Web Mercator).
  const { text, px } = await page.locator('.scale').evaluate((el) => ({ text: el.textContent ?? '', px: el.querySelector('.scale-bar')!.getBoundingClientRect().width }));
  const metres = parseFloat(text.replace(/[^\d.]/g, '')) * (text.includes(km) ? 1000 : 1);
  const world = (40075016.686 * Math.cos((from.lat * Math.PI) / 180)) / (metres / px);
  const at = mercator(from.lat, from.lon);
  return {
    zoom: Math.log2(world / 512),
    points: places.map(([lat, lon]) => { const p = mercator(lat, lon); return { x: from.x + (p.x - at.x) * world, y: from.y + (p.y - at.y) * world }; }),
  };
}

/** How far one turn of the mouse wheel (420 pixels) zooms the map in, in zoom levels (measured: six turns, 3.14 levels). */
const PER_TURN = 0.52;

/** A rectangle cut to fit inside another. */
function clip(r: Rect, within: Rect): Rect {
  const x0 = Math.max(r.x, within.x), y0 = Math.max(r.y, within.y);
  const x1 = Math.min(r.x + r.width, within.x + within.width), y1 = Math.min(r.y + r.height, within.y + within.height);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** The rectangle around points. */
function around(points: { x: number; y: number }[]): Rect {
  const x0 = Math.min(...points.map((p) => p.x)), y0 = Math.min(...points.map((p) => p.y));
  return { x: x0, y: y0, width: Math.max(...points.map((p) => p.x)) - x0, height: Math.max(...points.map((p) => p.y)) - y0 };
}

/** Moves and presses the way a hand would: gliding there by the clock (eased in and out), with a moment after. */
function hand(page: Page) {
  let at = { x: Math.round(SIZE.width * 0.62), y: Math.round(SIZE.height * 0.3) };
  async function glide(to: { x: number; y: number }, ms = 450, ease = true) {
    const from = at, start = Date.now();
    for (;;) {
      const f = Math.min(1, (Date.now() - start) / ms);
      const e = !ease ? f : f < 0.5 ? 2 * f * f : 1 - (2 - 2 * f) ** 2 / 2;
      await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      if (f === 1) break;
      await page.waitForTimeout(16);
    }
    at = to;
  }
  const middle = async (loc: Locator) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  return {
    glide,
    middle,
    /** Shows the pointer where it starts, as on a page just opened. */
    appear: () => page.mouse.move(at.x, at.y),
    async click(loc: Locator, { ms = 400, after = 250 } = {}) {
      await glide(await middle(loc), ms);
      await loc.click({ delay: 70 });
      await page.waitForTimeout(after);
    },
    /** Presses where the pointer is, glides along the legs (holding `hold` ms at the end of each), and lets go. */
    async drag(legs: { to: { x: number; y: number }; ms: number; hold: number }[]) {
      await page.mouse.down();
      for (const leg of legs) {
        await glide(leg.to, leg.ms);
        await page.waitForTimeout(leg.hold);
      }
      await page.mouse.up();
    },
  };
}

for (const lang of ['en', 'zh'] as const) {
  test(`demo video (${lang})`, async ({ browser }) => {
    const dry = process.env.DEMO_DRY_RUN;
    const t = (key: string, p?: Record<string, string | number>) => translate(lang, key, p);
    const say = SAY[lang];
    // The last 15 s: along Escondido Road to the stop in front of Branner Hall.
    const finish = driveEnd(15);
    const ctx = await browser.newContext({ viewport: SIZE, timezoneId: 'America/New_York', locale: lang === 'zh' ? 'zh-CN' : 'en-US' });
    const page = await ctx.newPage();
    await page.addInitScript(overlay);
    await page.addInitScript((l) => {
      (window as unknown as { tlpTestHooks: boolean }).tlpTestHooks = true;
      localStorage.setItem('tlp.prefs.v1', JSON.stringify({ lang: l, basemap: 'light', zone: 'local', timelineMin: false }));
    }, lang);
    await page.goto('./');
    await page.waitForLoadState('networkidle');

    const pause = (ms: number) => page.waitForTimeout(ms);
    const beats: { text: string; at: number }[] = []; // when each caption came up, to see what takes the time
    const caption = (text: string, where: 'top' | 'bottom' = 'top') => {
      beats.push({ text, at: Date.now() });
      return page.evaluate(([s, w]) => (window as unknown as { demoCaption: (t: string, w: string) => void }).demoCaption(s, w), [text, where] as const);
    };
    /** A red box around parts of the page or rectangles on it; `keep` keeps it up for the whole step, past the next press. */
    const mark = async (parts: (Locator | Rect)[], keep = false, pad = 10) => {
      const rects = await Promise.all(parts.map(async (p) => ('x' in p ? p : (await p.boundingBox())!)));
      const x0 = Math.min(...rects.map((r) => r.x)) - pad, y0 = Math.min(...rects.map((r) => r.y)) - pad;
      const x1 = Math.max(...rects.map((r) => r.x + r.width)) + pad, y1 = Math.max(...rects.map((r) => r.y + r.height)) + pad;
      await page.evaluate(([r, k]) => (window as unknown as { demoBox: (r: Rect, k: boolean) => void }).demoBox(r, k), [{ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, keep] as const);
    };
    /** Takes the boxes down, kept ones too, before what they mark goes away. */
    const unmark = () => page.evaluate(() => { for (const box of document.querySelectorAll('.demo-box')) box.remove(); });
    const row = (id: string) => page.locator(`.track-row[data-track="${id}"]`);
    const lines = async () => Number((await page.locator('.map').getAttribute('data-lines')) ?? 0);
    /** A point over the timeline's first lane, at a share of its time span. */
    const lanePoint = async (share: number) => {
      const b = (await page.locator('.tl-lanes').boundingBox())!;
      const lw = await page.locator('.tl-ticks').evaluate((el) => parseFloat(getComputedStyle(el).marginLeft));
      return { x: b.x + lw + (b.width - lw) * share, y: b.y + 30 };
    };
    const me = hand(page);

    // Recorded once the page is built and painted, with the pointer where it starts.
    await me.appear();
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))));
    const rec = await record(page);

    // ---- One track: a walk in Lower Manhattan.
    await caption(say.intro);
    await pause(1500);

    await caption(say.open);
    const walk = page.waitForEvent('filechooser');
    await me.click(page.getByRole('button', { name: t('empty.open'), exact: true }), { ms: 600, after: 0 });
    await (await walk).setFiles(join(FIX, 'lower-manhattan-walk.gpx'));
    await expect.poll(lines, { timeout: 30_000 }).toBeGreaterThan(0);
    await pause(500);
    await mark([row('A').locator('.stats')]);
    await pause(900);

    await caption(say.timeline);
    // From later in the walk back to its start: the fix card goes back along the track.
    await me.glide(await lanePoint(0.72), 550);
    await me.glide(await lanePoint(0.2), 1500, false);
    await mark([page.locator('.tooltip')]);
    await pause(1300);

    await caption(say.play);
    await me.click(page.getByRole('button', { name: t('timeline.play') }));
    await pause(1600);
    await me.click(page.getByRole('button', { name: t('timeline.pause') }), { after: 200 });

    await caption(say.color);
    const card = row('A').locator('.settings-hit');
    await me.click(card, { after: 250 });
    await me.click(page.getByRole('radio', { name: t('settings.asColor', { m: t('measure.ele') }) }), { after: 250 });
    await me.click(page.getByRole('radio', { name: t('settings.asHalo', { m: t('measure.speed') }) }), { after: 400 });
    await me.click(card, { after: 200 });
    await mark([card]);
    await pause(900);

    await caption(say.rename);
    await me.click(row('A').locator('.track-name'), { after: 250 });
    await page.keyboard.type(say.name, { delay: 60 });
    await page.keyboard.press('Enter');
    await mark([row('A').locator('.track-name')]);
    await pause(1100);

    await caption(say.properties);
    await me.click(row('A').getByRole('button', { name: new RegExp(`^${t('track.details')}`) }), { after: 450 });
    await mark([page.locator('.details-sec[aria-labelledby="d-summary"]')]);
    await pause(1300);
    await me.click(page.getByRole('button', { name: t('common.back') }), { after: 300 });

    // The Options menu opens under the basemap button, so this caption goes at the bottom.
    await caption(say.basemap, 'bottom');
    const tile = (id: string) => page.locator('.bm-tile', { has: page.getByText(t(`basemap.${id}`), { exact: true }) });
    await me.click(page.locator('.bm-button'), { after: 350 });
    await mark([page.locator('.bm-grid')], true);
    await pause(400);
    // Satellite imagery with labels, kept for the rest of the demo.
    await me.click(tile('hybrid'), { after: 1500 });
    await unmark();
    await me.click(page.locator('.options-menu .picker-head').getByRole('button', { name: t('common.close') }), { ms: 350, after: 150 });

    // ---- Three loggers on one drive, combined.
    await caption(say.more);
    const drive = page.waitForEvent('filechooser');
    await me.click(page.getByRole('button', { name: t('tracks.add'), exact: true }), { after: 0 });
    await (await drive).setFiles(STANFORD.map((f) => join(FIX, f)));
    await expect(page.locator('.track-row')).toHaveCount(4);
    // Time for the tiles of the whole continent, where the map now shows both places.
    await pause(900);
    await me.click(page.getByRole('button', { name: t('track.hide', { id: 'A' }) }), { after: 150 });
    await me.click(page.getByRole('button', { name: t('track.show', { id: 'D' }) }), { after: 150 });
    await me.click(page.getByRole('button', { name: t('map.fit') }), { after: 1100 });

    await caption(say.combine);
    await me.click(page.getByRole('button', { name: t('tracks.select'), exact: true }), { after: 200 });
    for (const id of ['B', 'C', 'D']) await me.click(page.getByRole('checkbox', { name: new RegExp(`^${t('select.track', { id })}`) }), { ms: 320, after: 120 });
    await me.click(page.getByRole('toolbar').getByRole('button', { name: t('select.combine') }), { after: 300 });
    await expect(row('E')).toHaveCount(1);
    await mark([page.locator('.combo-logs')]);
    await pause(1000);

    await caption(say.closeup);
    // To the end of the timeline: the cursor's dot goes to the end of the drive, on Escondido Road in front of Branner Hall.
    await me.glide(await lanePoint(0.999), 600);
    const tip = page.locator('.tooltip');
    const dot = async () => ({ lat: finish.lat, lon: finish.lon, x: Number(await tip.getAttribute('data-x')), y: Number(await tip.getAttribute('data-y')) });
    // Zoomed in around the point that brings the drive's last stretch to the middle of the map: as close as it fits,
    // and at least to zoom 17, where fixes show. Pointing at the map leaves the cursor where it is.
    const panel = (await page.locator('.panel').boundingBox())!, timeline = (await page.locator('.timeline').boundingBox())!;
    const left = panel.x + panel.width + 16;
    const area = { x: left, y: 150, width: SIZE.width - left - 16, height: timeline.y - 16 - 150 };
    const before = await onScreen(page, await dot(), finish.near, t('unit.km'));
    const region = around(before.points);
    const room = Math.log2(Math.min((area.width * 0.8) / Math.max(region.width, 1), (area.height * 0.6) / Math.max(region.height, 1)));
    const turns = Math.min(10, Math.max(Math.ceil((17.3 - before.zoom) / PER_TURN), Math.floor(room / PER_TURN)));
    const k = 2 ** (turns * PER_TURN);
    const mid = { x: region.x + region.width / 2, y: region.y + region.height / 2 };
    const goal = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    await me.glide({ x: mid.x + (mid.x - goal.x) / (k - 1), y: mid.y + (mid.y - goal.y) / (k - 1) }, 500);
    for (let n = 0; n < turns; n++) { await page.mouse.wheel(0, -420); await pause(170); }
    await pause(450);
    const closeup = await onScreen(page, await dot(), finish.near, t('unit.km'));
    if (dry) console.log(`  close-up: ${turns} turns, zoom ${before.zoom.toFixed(2)} → ${closeup.zoom.toFixed(2)}`);
    // The fix card would cover the lines: closed.
    await me.click(tip.locator('.tip-close'), { ms: 400, after: 200 });
    const lot = clip(around(closeup.points), area);
    await mark([lot], false, 20);
    await pause(1000);

    await caption(say.onmap);
    await mark([page.locator('.panel-sec[aria-labelledby="onmap-h"]')], true);
    await mark([lot], true, 20);
    await me.click(page.getByRole('button', { name: t('onmap.fixes'), exact: true }), { after: 1100 });
    await me.click(page.getByRole('button', { name: t('onmap.arrows'), exact: true }), { after: 1000 });

    await caption(say.trust);
    await me.click(page.getByRole('button', { name: t('combine.adjust') }), { after: 250 });
    await mark([page.locator('.trust-shape')], true);
    await mark([lot], true, 20);
    await pause(300);
    // Toward each source in turn: the combined track follows it. Then back to equal trust.
    const corner = (n: number) => me.middle(page.locator('.trust-corner').nth(n));
    await me.glide(await me.middle(page.locator('.trust-handle')), 400);
    await me.drag([{ to: await corner(0), ms: 600, hold: 500 }, { to: await corner(1), ms: 700, hold: 500 }, { to: await corner(2), ms: 700, hold: 500 }]);
    await me.click(page.locator('.trust-center'), { after: 600 });

    await caption(say.end);
    await pause(1700);

    const end = Date.now();
    const { shots, frames } = await rec.stop();
    await ctx.close();
    const seconds = frames / FPS;
    if (dry) {
      // The picture on screen every two seconds, and how long each caption stays up.
      mkdirSync(dry, { recursive: true });
      for (let s = 0, i = 0; s * 2 * FPS < frames; s++) {
        while (i + 1 < shots.length && shots[i + 1].first <= s * 2 * FPS) i++;
        if (shots[i]) writeFileSync(join(dry, `${lang}-${String(2 * s).padStart(2, '0')}s.jpg`), shots[i].jpeg);
      }
      console.log(`${lang}: ${shots.length} pictures over ${seconds.toFixed(1)} s`);
      beats.forEach((b, i) => console.log(`  ${(((beats[i + 1]?.at ?? end) - b.at) / 1000).toFixed(1).padStart(5)} s  ${b.text}`));
    }
    if (seconds > LONGEST) throw new Error(`the ${lang} video runs ${seconds.toFixed(1)} s, over ${LONGEST} s`);
    if (dry) return;
    mkdirSync(OUT, { recursive: true });
    await encodeMp4(browser, shots, frames, join(OUT, `demo-${lang}.mp4`));
    console.log(`${lang}: ${seconds.toFixed(1)} s`);
  });
}
