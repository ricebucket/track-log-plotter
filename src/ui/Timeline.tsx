// The timeline: one lane per shown track, a shared cursor, and the readout.
// Lanes are drawn straight onto a canvas. A chart library such as uPlot isn't
// used because nearly everything here is custom drawing (colored step bands,
// gaps, button presses, lanes of different heights). If the timeline ever
// needs zooming and panning, uPlot is the library worth adding back.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MeasureKey } from '../model/types';
import type { TrackItem } from '../state/logic';
import * as S from '../state/store';
import { t } from '../state/store';
import { axisRange } from '../state/logic';
import { fixAt } from '../state/inspect';
import { palette, UNKNOWN } from '../color/palettes';
import { differentDays, fmtClock, fmtDateClock, fmtShortDate, isMidnight, offsetLabel, offsetMinutes, zoneCity } from '../time/zones';
import { columns, playStep, ticks } from './timelineMath';
import { measureName, valueText } from './labels';
import { badgeOf } from './TrackRow';
import { IconChevronDown, IconPause, IconPlay, IconTimeline } from './icons';
import { NARROW, useMedia } from './hooks';
import { Computed } from './Computed';
import { measureHint } from './TrackRow';
import { explain } from './computedText';

/** Width of the lane label column plus its gap, on wide and phone-sized screens. */
const LABEL_W = { wide: 150, narrow: 76 };

function Lane({ item, t0, t1, tall, narrow, labelW }: { item: TrackItem; t0: number; t1: number; tall: boolean; narrow: boolean; labelW: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const key = (item.color === 'none' ? 'speed' : item.color) as MeasureKey;
  const scale = S.scaleFor(item.track, key);
  const colors = palette(item.fam, item.color, S.dark.value, S.single.value);
  const offset = S.offsets.value[item.id] ?? 0;
  const h = tall ? (narrow ? 40 : 66) : (narrow ? 12 : 18);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext?.('2d');
    if (!el || !g || w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cols = columns(item.track, key, item.color === 'none' ? null : scale, t0, t1, w, offset);
    const unknown = S.dark.value ? UNKNOWN.dark : UNKNOWN.light;
    const colorOf = (step: number) => (item.color === 'none' ? colors[0] : step >= 0 ? colors[Math.min(step, colors.length - 1)] : unknown);
    let lo = Infinity, hi = -Infinity;
    for (const c of cols) if (c && !c.gap && Number.isFinite(c.max)) { lo = Math.min(lo, c.min); hi = Math.max(hi, c.max); }
    if (tall) {
      // The selected track: one graph. Its height is the value and its fill is
      // the color the map gives that value, so there is no second strip to explain.
      const top = 4, bottom = h - 1;
      const base = Math.min(0, lo);
      const yOf = (v: number) => bottom - ((v - base) / Math.max(1e-9, hi - base)) * (bottom - top);
      for (let x = 0; x < cols.length; x++) {
        const c = cols[x];
        if (!c) continue;
        if (c.gap) { g.fillStyle = 'rgba(16,24,32,0.10)'; g.fillRect(x, 0, 1, h); continue; }
        if (!Number.isFinite(c.max) || !Number.isFinite(lo)) { g.fillStyle = unknown; g.fillRect(x, bottom - 4, 1.4, 4); continue; }
        const y = yOf(c.max);
        g.fillStyle = colorOf(c.step);
        g.fillRect(x, y, 1.4, bottom - y);
      }
      g.strokeStyle = 'rgba(16,24,32,0.7)';
      g.lineWidth = 1.2;
      g.beginPath();
      let open = false;
      for (let x = 0; x < cols.length; x++) {
        const c = cols[x];
        if (!c || c.gap || !Number.isFinite(c.max) || !Number.isFinite(lo)) { open = false; continue; }
        const y = yOf(c.max);
        if (!open) { g.moveTo(x, y); open = true; } else g.lineTo(x, y);
      }
      g.stroke();
    } else {
      // Other shown tracks: a strip of the map colors.
      for (let x = 0; x < cols.length; x++) {
        const c = cols[x];
        if (!c) continue;
        if (c.gap) { g.fillStyle = 'rgba(16,24,32,0.10)'; g.fillRect(x, 0, 1, h); continue; }
        g.fillStyle = Number.isFinite(c.max) ? colorOf(c.step) : unknown;
        g.fillRect(x, 3, 1.4, h - 6);
      }
    }
    g.fillStyle = '#101820';
    for (const f of item.track.flags) {
      const x = ((f.t + offset - t0) / Math.max(1, t1 - t0)) * w;
      if (x >= 0 && x <= w) g.fillRect(Math.round(x) - 0.75, 0, 1.6, h);
    }
  }, [w, h, item, t0, t1, offset, scale, colors.join(), S.dark.value, S.single.value]);

  const shifted = offset !== 0;
  return (
    <div class="lane" style={{ height: `${h}px` }}>
      <div class="lane-label" style={{ width: `${labelW - 10}px` }}>
        <span class="badge small" style={{ background: badgeOf(item) }}>{item.id}</span>
        <span class="lane-text">
          <span class="lane-measure">{measureName(key)}{(key === 'grade' || (key === 'speed' && !item.track.derived.speedFromFile) || (key === 'hdop' && scale.relative)) && <Computed text={measureHint(item, key, scale)!} />}</span>
          {!narrow && (tall || shifted) ? <span class="lane-note">{shifted ? t('timeline.fromStart', { date: fmtShortDate(item.track.derived.stats.start, S.zone.value, S.locale.value) }) : ''}</span> : null}
        </span>
      </div>
      <canvas ref={canvas} class="lane-canvas" style={{ height: `${h}px` }} aria-hidden="true" />
    </div>
  );
}

function ZoneButtons({ at }: { at: number }) {
  const z = S.zone.value;
  const custom = z !== 'local' && z !== 'utc';
  return (
    <div class="seg small" role="group" aria-label={t('zone.label')}>
      <button type="button" aria-pressed={z === 'local' ? 'true' : 'false'} title={t('zone.localHint', { offset: offsetLabel(at, 'local') })} onClick={() => { S.zone.value = 'local'; }}>{t('zone.local')}</button>
      <button type="button" aria-pressed={z === 'utc' ? 'true' : 'false'} onClick={() => { S.zone.value = 'utc'; }}>UTC</button>
      <button type="button" data-zone-trigger aria-pressed={custom ? 'true' : 'false'} aria-haspopup="dialog" aria-expanded={S.zoneOpen.value ? 'true' : 'false'} onClick={() => { S.zoneOpen.value = !S.zoneOpen.value; }}>
        {custom ? zoneCity(z) : t('zone.other')}<IconChevronDown size={11} />
      </button>
    </div>
  );
}

export function Timeline() {
  const vis = S.visible.value;
  const sel = S.selected.value;
  const offsets = S.offsets.value;
  const [t0, t1] = axisRange(vis, offsets);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const cursor = S.cursorT.value ?? t0;
  const frac = Math.min(1, Math.max(0, (cursor - t0) / Math.max(1, t1 - t0)));
  const loc = S.locale.value;
  const z = S.zone.value;
  const [tickW, setTickW] = useState(800);
  const narrow = useMedia(NARROW);
  const LW = narrow ? LABEL_W.narrow : LABEL_W.wide;

  useEffect(() => {
    const el = lanesRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTickW(Math.max(100, el.clientWidth - LW)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [LW]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      // Holds still while the cursor is dragged along a track; loops at the end.
      if (!S.scrubbing.peek()) S.cursorT.value = playStep(S.cursorT.value ?? t0, dt, t0, t1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, t0, t1]);

  // Pointer events can come faster than frames: apply at most one per frame.
  const pendingT = useRef<number | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const onPointer = (e: PointerEvent) => {
    const el = lanesRef.current;
    if (!el) return;
    // During playback, only a press (or a drag with the button down) moves the cursor, not hovering.
    if (playing && e.type === 'pointermove' && !(e.buttons & 1)) return;
    const r = el.getBoundingClientRect();
    const f = (e.clientX - r.left - LW) / Math.max(1, r.width - LW);
    if (f < 0 || f > 1) return;
    pendingT.current = t0 + f * (t1 - t0);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pendingT.current !== null) S.cursorT.value = pendingT.current;
    });
  };

  const selFix = sel && sel.vis ? fixAt(sel.track, S.trackTime(sel.id, cursor)) : null;
  const readout = selFix
    ? [valueText('speed', selFix.kmh), Number.isFinite(selFix.ele) ? valueText('ele', selFix.ele) : null, Number.isFinite(selFix.hdop) ? `HDOP ${valueText('hdop', selFix.hdop)}` : null, Number.isFinite(selFix.sats) ? valueText('sats', selFix.sats) : null].filter(Boolean).join(' · ')
    : '';
  const step = sel ? sel.track.derived.stats.intervalS * 1000 : 1000;
  const tickList = ticks(t0, t1, tickW, offsetMinutes(t0, z));
  // Tracks that run past midnight or over several days: the readout shows the
  // date, and a tick at midnight shows the new date instead of 12:00 AM.
  const multiDay = differentDays(t0, t1, z);

  return (
    <section class="timeline" aria-label={t('timeline.label')}>
      <div class="tl-head">
        <button type="button" class="round-btn" aria-label={playing ? t('timeline.pause') : t('timeline.play')} title={playing ? t('timeline.pause') : t('timeline.play')} onClick={() => setPlaying(!playing)}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        {sel && <span class="badge small" style={{ background: badgeOf(sel) }}>{sel.id}</span>}
        <span class="tl-time mono" aria-live="polite">{(multiDay ? fmtDateClock : fmtClock)(selFix ? selFix.t : cursor, z, loc)}</span>
        <span class="muted small tl-offset">{offsetLabel(cursor, z)}</span>
        <span class="tl-divider" />
        <span class="tl-values mono">{readout}</span>
        {selFix && sel && !sel.track.derived.speedFromFile && <Computed text={explain.speedDerived()} />}
        <span class="grow" />
        <ZoneButtons at={cursor} />
        <button type="button" class="icon-btn outline" aria-expanded="true" aria-label={t('timeline.hide')} title={t('timeline.hide')} onClick={() => { S.timelineMin.value = true; S.zoneOpen.value = false; }}>
          <IconChevronDown size={16} />
        </button>
      </div>
      <div class="tl-lanes" ref={lanesRef} onPointerMove={onPointer} onPointerDown={onPointer}>
        {vis.map((it) => <Lane key={it.id} item={it} t0={t0} t1={t1} tall={it.id === sel?.id || vis.length === 1} narrow={narrow} labelW={LW} />)}
        <div class="tl-cursor" style={{ left: `calc(${LW}px + (100% - ${LW}px) * ${frac})` }} />
        <input
          class="sr-only" type="range" aria-label={t('timeline.scrub')} min={t0} max={t1} step={step} value={cursor}
          onInput={(e) => { S.cursorT.value = Number((e.currentTarget as HTMLInputElement).value); }}
        />
      </div>
      <div class="tl-ticks" style={{ marginLeft: `${LW}px` }} aria-hidden="true">
        {tickList.map((tk) => (
          isMidnight(tk, z)
            ? <span key={tk} class="tick-date" style={{ left: `${((tk - t0) / Math.max(1, t1 - t0)) * 100}%` }}>{fmtShortDate(tk, z, loc)}</span>
            : <span key={tk} style={{ left: `${((tk - t0) / Math.max(1, t1 - t0)) * 100}%` }}>{fmtClock(tk, z, loc, false)}</span>
        ))}
      </div>
    </section>
  );
}

/** The minimized timeline: just a button that brings it back. */
export function TimelineButton() {
  return (
    <button type="button" class="pane-pill timeline-pill" aria-expanded="false" aria-label={t('timeline.show')} title={t('timeline.show')} onClick={() => { S.timelineMin.value = false; }}>
      <IconTimeline />
    </button>
  );
}
