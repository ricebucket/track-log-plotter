// A combined track's own part of its card: its logs (an eye each, how much each
// counts, its typical error) and how much to trust each, set by dragging a
// handle on a line (two logs) or in a triangle (three logs).
import { useRef, useState } from 'preact/hooks';
import { trackName, type TrackItem } from '../state/logic';
import * as S from '../state/store';
import { t } from '../state/store';
import type { ComboTrack } from '../combine/combine';
import { LOG_COLORS } from '../color/palettes';
import { FORMAT_SHAPE } from '../color/shapes';
import { fmtPercent } from '../format';
import { metresText } from './labels';
import { fullTextIfCut } from './cutText';
import { IconChevronDown, IconChevronUp, IconEye, IconEyeOff } from './icons';

/** What a combined track calls its sources: the letters they had in the list when it was made. */
export function sourceNames(item: TrackItem, track: ComboTrack): string[] {
  return track.combo.sources.map((_, k) => item.sources?.[k] ?? String(k + 1));
}

/** What each source is called in the list, renamed or not; once it has left the list, its file's name. */
export function sourceTitles(item: TrackItem, track: ComboTrack): string[] {
  const list = S.items.value;
  return track.combo.sources.map((s, k) => {
    // The same track, or (its time zone changed since) the same file under the letter it had.
    const x = list.find((it) => it.track === s.track) ?? list.find((it) => it.id === item.sources?.[k] && it.track.file === s.track.file);
    return x ? trackName(x) : s.track.file;
  });
}

/** A source's badge, as in the track list (its letter, its file's shape), in the color of its line on the map. */
export function SourceBadge({ track, k, name, size = 'small' }: { track: ComboTrack; k: number; name: string; size?: 'small' | 'tiny' }) {
  const f = track.combo.sources[k].track.format;
  return <span class={`badge ${FORMAT_SHAPE[f]} ${size}`} style={{ background: LOG_COLORS[k % LOG_COLORS.length] }} aria-hidden="true">{name}</span>;
}

/** "equal", or each source's share: "B at 65%, C at 35%". */
export function sharesText(trust: readonly number[], names: readonly string[]): string {
  if (trust.every((v) => Math.abs(v - 1 / trust.length) < 0.005)) return t('combine.equal');
  const loc = S.locale.value;
  return trust.map((v, k) => t('combine.share', { k: names[k], p: fmtPercent(v, loc) })).join(t('combine.sep'));
}

/** What a source at 0% trust still does (fills gaps), and what one with all the trust gets: never left out. */
function zeroText(trust: readonly number[], names: readonly string[]): string | null {
  const zero = trust.flatMap((v, k) => (v < 0.005 ? [names[k]] : []));
  const full = zero.length === trust.length - 1 ? ` ${t('combine.fullTrust', { k: names[trust.findIndex((v) => v >= 0.005)] })}` : '';
  if (zero.length === 1) return t('combine.zeroOne', { k: zero[0] }) + full;
  if (zero.length === 2) return t('combine.zeroTwo', { a: zero[0], b: zero[1], c: names[trust.findIndex((v) => v >= 0.005)] }) + full;
  return null;
}

export function CombinedLogs({ item, track }: { item: TrackItem; track: ComboTrack }) {
  const [open, setOpen] = useState(false);
  const loc = S.locale.value;
  const src = track.combo.sources;
  const trust = src.map((s) => s.trust);
  const names = sourceNames(item, track);
  const titles = sourceTitles(item, track);
  const zero = zeroText(trust, names);
  const hid = `combo-${item.id}`;
  return (
    <section class="combo" aria-labelledby={hid}>
      <h3 class="combo-h" id={hid}>{t('combine.itsLogs')}</h3>
      <ul class="combo-logs">
        {src.map((s, k) => {
          const on = item.logs?.[k] ?? true;
          const label = on ? t('combine.hideLog', { k: names[k] }) : t('combine.showLog', { k: names[k] });
          const sub = [t('combine.counts', { p: fmtPercent(s.share, loc) }), t('combine.typical', { m: metresText(s.typicalM) })];
          if (!on) sub.push(t('combine.hidden'));
          return (
            <li key={k} class={on ? undefined : 'is-off'} data-log={names[k]}>
              <button type="button" class="icon-btn eye" aria-pressed={on ? 'true' : 'false'} aria-label={label} title={label} onClick={() => S.toggleLog(item.id, k)}>
                {on ? <IconEye size={17} /> : <IconEyeOff size={17} />}
              </button>
              <SourceBadge track={track} k={k} name={names[k]} />
              <span class="combo-log">
                <span class="combo-file" onMouseEnter={fullTextIfCut(titles[k])}>{titles[k]}</span>
                <span class="combo-sub">{sub.join(' · ')}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div class="trust-line">
        <span class="trust-cap">{t('combine.trust')}</span>
        <span class="trust-val">{sharesText(trust, names)}</span>
        <button type="button" class="link-btn trust-toggle" aria-expanded={open ? 'true' : 'false'} aria-controls={`${hid}-trust`} onClick={() => setOpen(!open)}>
          <span>{open ? t('combine.hide') : t('combine.adjust')}</span>
          {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </div>
      {open && (
        <div class="trust-box" id={`${hid}-trust`}>
          <TrustShape item={item} trust={trust} names={names} />
          <p class="muted small trust-hint">{t('combine.shapeHint')}</p>
          {zero && <p class="trust-zero" role="status">{zero}</p>}
        </div>
      )}
    </section>
  );
}

const W = 232;
const PAD = 18;
/** Dropping the handle this close to the center (px) makes the logs equal. */
const SNAP = 8;

/** Where each log's corner sits: the ends of a line, or the corners of a triangle (log 1 at the top). */
function corners(K: number): { pts: [number, number][]; h: number } {
  if (K === 2) return { pts: [[PAD, 26], [W - PAD, 26]], h: 52 };
  const side = W - 2 * PAD, h = Math.round((side * Math.sqrt(3)) / 2) + 2 * PAD;
  return { pts: [[W / 2, PAD], [PAD, h - PAD], [W - PAD, h - PAD]], h };
}

/** Shares rounded to whole percents that still add up to 1. */
function tidy(w: number[]): number[] {
  const r = w.map((v) => Math.round(Math.max(0, v) * 100));
  const sum = r.reduce((a, b) => a + b, 0);
  if (sum === 0) return w.map(() => 1 / w.length);
  r[r.indexOf(Math.max(...r))] += 100 - sum;
  return r.map((v) => v / 100);
}

export function TrustShape({ item, trust, names }: { item: TrackItem; trust: readonly number[]; names: readonly string[] }) {
  const K = trust.length;
  const { pts, h } = corners(K);
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number[] | null>(null);
  const shown = drag ?? [...trust];
  const equal = Array.from({ length: K }, () => 1 / K);
  const at = (w: readonly number[]): [number, number] => [w.reduce((s, v, k) => s + v * pts[k][0], 0), w.reduce((s, v, k) => s + v * pts[k][1], 0)];
  const mid = at(equal);

  /** The shares for a point in the shape's own units: the nearest spot on the line, or in the triangle. */
  const toTrust = (x: number, y: number): number[] => {
    let w: number[];
    if (K === 2) {
      const f = Math.min(1, Math.max(0, (x - pts[0][0]) / (pts[1][0] - pts[0][0])));
      w = [1 - f, f];
    } else {
      const [a, b, c] = pts;
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      const w1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
      const w2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
      const raw = [w1, w2, 1 - w1 - w2].map((v) => Math.max(0, v));
      const sum = raw.reduce((s, v) => s + v, 0);
      w = raw.map((v) => v / sum);
    }
    const [px, py] = at(w);
    return Math.hypot(px - mid[0], py - mid[1]) < SNAP ? equal : tidy(w);
  };
  const fromEvent = (e: PointerEvent): number[] => {
    const box = ref.current!.getBoundingClientRect();
    return toTrust(((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * h);
  };
  const set = (w: number[], now: boolean) => { if (now) S.applyTrust(item.id, w); else S.setTrust(item.id, w); };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const w = fromEvent(e);
    setDrag(w);
    set(w, false);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const w = fromEvent(e);
    setDrag(w);
    set(w, false);
  };
  const onUp = (e: PointerEvent) => {
    if (!drag) return;
    set(fromEvent(e), true);
    setDrag(null);
  };
  // Arrows move the handle a step in their direction; Home puts it back in the center. On the line of two
  // sources, Up and Down move it along the line like Right and Left, as on any slider: Up and Right give
  // the right-hand source more trust, which is the value read out. In the triangle, the value is the top
  // source's trust, which Up raises and Down lowers (Left and Right move between the bottom two).
  // A step that changes nothing (at the end of the line) works nothing out again: the store skips shares the track already has.
  const onKey = (e: KeyboardEvent) => {
    const step = (K === 2 ? pts[1][0] - pts[0][0] : W - 2 * PAD) * 0.05;
    const [x, y] = at(shown);
    const moves: Record<string, [number, number]> = K === 2
      ? { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [step, 0], ArrowDown: [-step, 0] }
      : { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === 'Home') { e.preventDefault(); set(equal, true); return; }
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    set(toTrust(x + m[0], y + m[1]), true);
  };

  const [hx, hy] = at(shown);
  const isEqual = shown.every((v) => Math.abs(v - 1 / K) < 0.005);
  return (
    <svg
      ref={ref} class="trust-shape" viewBox={`0 0 ${W} ${h}`} width={W} height={h} role="group" aria-label={t('combine.shape')}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
    >
      {K === 2
        ? <path d={`M${pts[0][0]} ${pts[0][1]}H${pts[1][0]}`} class="trust-track" />
        : <path d={`M${pts[0][0]} ${pts[0][1]}L${pts[1][0]} ${pts[1][1]}L${pts[2][0]} ${pts[2][1]}Z`} class="trust-track" />}
      {/* The center: every log counts the same. Clicking it (or Home on the handle) goes back there. */}
      <g
        class={`trust-center${isEqual ? ' is-on' : ''}`} role="button" tabIndex={0} aria-label={t('combine.makeEqual')} data-tip={t('combine.makeEqual')}
        onClick={() => set(equal, true)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(equal, true); } }}
      >
        <circle cx={mid[0]} cy={mid[1]} r={9} class="trust-center-hit" />
        <path d={`M${mid[0] - 5} ${mid[1]}H${mid[0] + 5}M${mid[0]} ${mid[1] - 5}V${mid[1] + 5}`} />
      </g>
      {pts.map(([x, y], k) => (
        <g key={k} class="trust-corner" aria-hidden="true">
          <circle cx={x} cy={y} r={9} fill={LOG_COLORS[k]} />
          <text x={x} y={y + 3.6} text-anchor="middle">{names[k]}</text>
        </g>
      ))}
      <circle
        class="trust-handle" cx={hx} cy={hy} r={8} tabIndex={0} role="slider" aria-label={t('combine.handle')}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((K === 2 ? shown[1] : shown[0]) * 100)} aria-valuetext={sharesText(shown, names)} onKeyDown={onKey}
      />
    </svg>
  );
}
