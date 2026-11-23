// A combined track's own part of its card: its logs (an eye each, how much each
// counts, its typical error) and how much to trust each, set by dragging a
// handle on a line (two logs) or in a triangle (three logs).
import { useRef, useState } from 'preact/hooks';
import type { TrackItem } from '../state/logic';
import * as S from '../state/store';
import { t } from '../state/store';
import type { ComboTrack } from '../combine/combine';
import { LOG_COLORS } from '../color/palettes';
import { fmtPercent } from '../format';
import { metresText } from './labels';
import { fullTextIfCut } from './cutText';
import { IconChevronDown, IconChevronUp, IconEye, IconEyeOff } from './icons';

/** A log's number, 1 to 3, in its color: numbers, so they aren't taken for the list's letters. */
export function LogNumber({ k }: { k: number }) {
  return <span class="log-num" style={{ background: LOG_COLORS[k % LOG_COLORS.length] }} aria-hidden="true">{k + 1}</span>;
}

/** "equal", or each log's share: "1 at 65%, 2 at 35%". */
export function sharesText(trust: readonly number[]): string {
  if (trust.every((v) => Math.abs(v - 1 / trust.length) < 0.005)) return t('combine.equal');
  const loc = S.locale.value;
  return trust.map((v, k) => t('combine.share', { k: k + 1, p: fmtPercent(v, loc) })).join(t('combine.sep'));
}

/** What a log at 0% trust still does: fills gaps. */
function zeroText(trust: readonly number[]): string | null {
  const zero = trust.flatMap((v, k) => (v < 0.005 ? [k + 1] : []));
  if (zero.length === 1) return t('combine.zeroOne', { k: zero[0] });
  if (zero.length === 2) return t('combine.zeroTwo', { a: zero[0], b: zero[1], c: trust.findIndex((v) => v >= 0.005) + 1 });
  return null;
}

export function CombinedLogs({ item, track }: { item: TrackItem; track: ComboTrack }) {
  const [open, setOpen] = useState(false);
  const loc = S.locale.value;
  const src = track.combo.sources;
  const trust = src.map((s) => s.trust);
  const zero = zeroText(trust);
  const hid = `combo-${item.id}`;
  return (
    <section class="combo" aria-labelledby={hid}>
      <h3 class="combo-h" id={hid}>{t('combine.itsLogs')}</h3>
      <ul class="combo-logs">
        {src.map((s, k) => {
          const on = item.logs?.[k] ?? true;
          const label = on ? t('combine.hideLog', { k: k + 1 }) : t('combine.showLog', { k: k + 1 });
          const sub = [t('combine.counts', { p: fmtPercent(s.share, loc) }), t('combine.typical', { m: metresText(s.typicalM) })];
          if (!on) sub.push(t('combine.hidden'));
          return (
            <li key={k} class={on ? undefined : 'is-off'} data-log={k + 1}>
              <button type="button" class="icon-btn eye" aria-pressed={on ? 'true' : 'false'} aria-label={label} title={label} onClick={() => S.toggleLog(item.id, k)}>
                {on ? <IconEye size={17} /> : <IconEyeOff size={17} />}
              </button>
              <LogNumber k={k} />
              <span class="combo-log">
                <span class="combo-file" onMouseEnter={fullTextIfCut(s.track.file)}>{s.track.file}</span>
                <span class="combo-sub">{sub.join(' · ')}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div class="trust-line">
        <span class="trust-cap">{t('combine.trust')}</span>
        <span class="trust-val">{sharesText(trust)}</span>
        <button type="button" class="link-btn trust-toggle" aria-expanded={open ? 'true' : 'false'} aria-controls={`${hid}-trust`} onClick={() => setOpen(!open)}>
          <span>{open ? t('combine.hide') : t('combine.adjust')}</span>
          {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </div>
      {open && (
        <div class="trust-box" id={`${hid}-trust`}>
          <TrustShape item={item} trust={trust} />
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

export function TrustShape({ item, trust }: { item: TrackItem; trust: readonly number[] }) {
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
  // Arrows move the handle a step in their direction; Home puts it back in the center.
  const onKey = (e: KeyboardEvent) => {
    const step = (K === 2 ? pts[1][0] - pts[0][0] : W - 2 * PAD) * 0.05;
    const [x, y] = at(shown);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
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
        class={`trust-center${isEqual ? ' is-on' : ''}`} role="button" tabIndex={0} aria-label={t('combine.makeEqual')}
        onClick={() => set(equal, true)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(equal, true); } }}
      >
        <title>{t('combine.makeEqual')}</title>
        <circle cx={mid[0]} cy={mid[1]} r={9} class="trust-center-hit" />
        <path d={`M${mid[0] - 5} ${mid[1]}H${mid[0] + 5}M${mid[0]} ${mid[1] - 5}V${mid[1] + 5}`} />
      </g>
      {pts.map(([x, y], k) => (
        <g key={k} class="trust-corner" aria-hidden="true">
          <circle cx={x} cy={y} r={9} fill={LOG_COLORS[k]} />
          <text x={x} y={y + 3.6} text-anchor="middle">{k + 1}</text>
        </g>
      ))}
      <circle
        class="trust-handle" cx={hx} cy={hy} r={8} tabIndex={0} role="slider" aria-label={t('combine.handle')}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown[0] * 100)} aria-valuetext={sharesText(shown)} onKeyDown={onKey}
      />
    </svg>
  );
}
