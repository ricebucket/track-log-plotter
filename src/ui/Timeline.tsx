// The timeline: one lane per shown track, a shared cursor, and the readout.
// Lanes are drawn straight onto a canvas. A chart library such as uPlot isn't
// used because nearly everything here is custom drawing (colored step bands,
// gaps, button presses, lanes of different heights). If the timeline ever
// needs zooming and panning, uPlot is the library worth adding back.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Fragment } from 'preact';
import type { MeasureKey } from '../model/types';
import type { TrackItem } from '../state/logic';
import type { FixInfo } from '../state/inspect';
import * as S from '../state/store';
import { t } from '../state/store';
import { axisRange } from '../state/logic';
import { fixAt } from '../state/inspect';
import { palette, UNKNOWN } from '../color/palettes';
import { differentDays, fmtClock, fmtDateClock, fmtShortDate, isMidnight, offsetLabel, offsetMinutes, zoneCity } from '../time/zones';
import { columns, MIN_ZOOM_MS, panView, playStep, skipGap, snapTime, tickStep, ticks, wheelZoom } from './timelineMath';
import { measureName, valueText } from './labels';
import { Badge } from './Badge';
import { IconChevronDown, IconClock, IconFit, IconPause, IconPlay, IconTimeline, IconZoomOut, IconZoomReset } from './icons';
import { mapApi } from '../map/bridge';
import { NARROW, useMedia } from './hooks';
import { Computed } from './Computed';
import { measureHint } from './TrackRow';
import { explain } from './computedText';
import { MOVING_KMH } from '../derive/derive';

/** Fill of the halo graph. */
const HALO_GRAPH = 'rgba(16, 24, 32, 0.22)';

/** Width of the lane label column plus its gap, on wide and phone-sized screens. */
// Phones leave room in the label for the value at the cursor.
const LABEL_W = { wide: 150, narrow: 100 };

/**
 * One track's lane. `fromStart` is set when the lane is lined up at its start
 * rather than by clock: tracks from different days all start at the same point,
 * the selected one included.
 */
/** A fix's value of a measure, as text, for a lane label. */
function fixValue(key: MeasureKey, f: FixInfo): string {
  const v = key === 'speed' ? f.kmh : key === 'ele' ? f.ele : key === 'grade' ? f.grade : key === 'hdop' ? f.hdop : key === 'sats' ? f.sats : key === 'fix' ? f.fixq : f.accel;
  return Number.isFinite(v) && !(key === 'fix' && v <= 0) ? valueText(key, v) : '–';
}

function Lane({ item, t0, t1, tall, fromStart, narrow, labelW, cursor, halo = false }: { item: TrackItem; t0: number; t1: number; tall: boolean; fromStart: boolean; narrow: boolean; labelW: number; cursor: number; halo?: boolean }) {
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

  // The halo graph (below the selected track's lane) draws the halo measure in
  // a neutral gray: the halo has no colors of its own, and map colors would mislead.
  const key = (halo ? item.halo : item.color === 'none' ? 'speed' : item.color) as MeasureKey;
  const scale = S.scaleFor(item.track, key);
  const colors = halo ? [HALO_GRAPH] : palette(item.fam, item.color, S.dark.value, S.single.value);
  const plain = halo || item.color === 'none';
  const offset = S.offsets.value[item.id] ?? 0;
  // A short lane with a note gets room for its second line.
  const h = halo ? (narrow ? 30 : 46) : tall ? (narrow ? 40 : 66) : narrow ? 12 : fromStart ? 30 : 18;
  const logY = scale.log && !plain ? true : halo && scale.log;

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext?.('2d');
    if (!el || !g || w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cols = columns(item.track, key, plain && !halo ? null : scale, t0, t1, w, offset);
    const unknown = S.dark.value ? UNKNOWN.dark : UNKNOWN.light;
    const colorOf = (step: number) => (plain ? colors[0] : step >= 0 ? colors[Math.min(step, colors.length - 1)] : unknown);
    let lo = Infinity, hi = -Infinity;
    for (const c of cols) if (c && !c.gap && Number.isFinite(c.max)) { lo = Math.min(lo, c.min); hi = Math.max(hi, c.max); }
    if (tall || halo) {
      // The selected track: one graph. Its height is the value and its fill is
      // the color the map gives that value, so there is no second strip to explain.
      const top = 4, bottom = h - 1;
      // Most graphs stand on zero. Acceleration hovers around 1 g (gravity), so
      // its graph spans just the readings in view (at least 0.1 g), and the
      // waveform fills the lane.
      const base = key === 'accel' ? Math.min(lo, hi - 0.1) : Math.min(0, lo);
      // When the color steps are on a log scale, so is the graph: values below
      // walking pace sit on the axis.
      const yOf = logY && hi > MOVING_KMH
        ? (v: number) => bottom - (Math.log(Math.max(v, MOVING_KMH) / MOVING_KMH) / Math.log(hi / MOVING_KMH)) * (bottom - top)
        : (v: number) => bottom - ((v - base) / Math.max(1e-9, hi - base)) * (bottom - top);
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
        const sh = Math.min(12, h - 6);
        g.fillRect(x, (h - sh) / 2, 1.4, sh);
      }
    }
    g.fillStyle = '#101820';
    for (const f of item.track.flags) {
      const x = ((f.t + offset - t0) / Math.max(1, t1 - t0)) * w;
      if (x >= 0 && x <= w) g.fillRect(Math.round(x) - 0.75, 0, 1.6, h);
    }
  }, [w, h, item, t0, t1, offset, scale, logY, colors.join(), S.dark.value, S.single.value]);

  const shifted = fromStart;
  // On a phone the header has no readout: the graphs show their value at the cursor instead.
  const at = narrow && (tall || halo) ? fixAt(item.track, S.trackTime(item.id, cursor)) : null;
  return (
    <div class={`lane${halo ? ' halo-lane' : ''}`} data-track={item.id} data-role={halo ? 'halo' : 'color'} style={{ height: `${h}px` }}>
      <div class="lane-label" style={{ width: `${labelW - 10}px` }}>
        {halo ? <span class="badge-space" aria-hidden="true" /> : <Badge item={item} size="small" />}
        <span class="lane-text">
          <span class="lane-measure">{measureName(key)}{(key === 'grade' || key === 'accel' || (key === 'speed' && !item.track.derived.speedFromFile) || (key === 'hdop' && scale.relative)) && <Computed text={measureHint(item, key, scale)!} />}</span>
          {/* Each note on its own line, so a narrow label column never cuts one off. */}
          {at && <span class="lane-value">{fixValue(key, at)}</span>}
          {!narrow && halo && <span class="lane-note">{t('timeline.haloNote')}</span>}
          {!narrow && shifted && !halo && <span class="lane-note">{t('timeline.fromStart', { date: fmtShortDate(item.track.derived.stats.start, S.zone.value, S.locale.value) })}</span>}
          {!narrow && (tall || halo) && logY && <span class="lane-note">{t('timeline.logScale')}</span>}
        </span>
      </div>
      <canvas ref={canvas} class="lane-canvas" style={{ height: `${h}px` }} aria-hidden="true" />
    </div>
  );
}

/** On a phone: one button that names the zone in use and opens the list (Local and UTC at the top). */
function ZoneButton({ iconOnly }: { iconOnly: boolean }) {
  const z = S.zone.value;
  const name = z === 'local' ? t('zone.local') : z === 'utc' ? 'UTC' : zoneCity(z);
  return (
    <button
      type="button" class="zone-btn" data-zone-trigger aria-haspopup="dialog" aria-expanded={S.zoneOpen.value ? 'true' : 'false'}
      aria-label={`${t('zone.label')}: ${name}`} title={`${t('zone.label')}: ${name}`} onClick={() => { S.zoneOpen.value = !S.zoneOpen.value; }}
    >
      <IconClock size={14} />{!iconOnly && <span class="zone-btn-name">{name}</span>}<IconChevronDown size={11} />
    </button>
  );
}

function ZoneButtons({ at }: { at: number }) {
  const z = S.zone.value;
  const custom = z !== 'local' && z !== 'utc';
  // The third button keeps the last zone picked from the list, even while
  // Local or UTC is on; pressing it opens the list again.
  const named = custom ? z : S.lastZone.value;
  return (
    <div class="seg small" role="group" aria-label={t('zone.label')}>
      <button type="button" aria-pressed={z === 'local' ? 'true' : 'false'} title={t('zone.localHint', { offset: offsetLabel(at, 'local') })} onClick={() => { S.zone.value = 'local'; }}>{t('zone.local')}</button>
      <button type="button" aria-pressed={z === 'utc' ? 'true' : 'false'} onClick={() => { S.zone.value = 'utc'; }}>UTC</button>
      <button type="button" data-zone-trigger aria-pressed={custom ? 'true' : 'false'} aria-haspopup="dialog" aria-expanded={S.zoneOpen.value ? 'true' : 'false'} onClick={() => { S.zoneOpen.value = !S.zoneOpen.value; }}>
        {named ? zoneCity(named) : t('zone.other')}<IconChevronDown size={11} />
      </button>
    </div>
  );
}

export function Timeline() {
  const vis = S.visible.value;
  const sel = S.selected.value;
  const offsets = S.offsets.value;
  const [full0, full1] = axisRange(vis, offsets);
  // Zoomed in: the part of the timeline picked by dragging across it.
  const view = S.timelineView.value;
  const zoomed = !!view && view[0] >= full0 && view[1] <= full1 && view[1] - view[0] < full1 - full0;
  const [t0, t1] = zoomed ? view : [full0, full1];
  // Other tracks or a new alignment: show the whole timeline again.
  useEffect(() => { S.timelineView.value = null; }, [full0, full1]);
  // The track the others line up to (the selected one when it's shown), and
  // whether any track is lined up at its start rather than by clock.
  const refId = vis.find((x) => x.id === sel?.id)?.id ?? vis[0]?.id;
  const anyShifted = vis.some((x) => (offsets[x.id] ?? 0) !== 0);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const cursor = S.cursorT.value ?? t0;
  const raw = (cursor - t0) / Math.max(1, t1 - t0);
  const frac = Math.min(1, Math.max(0, raw));
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
      // Holds still while the cursor is dragged along a track; skips times
      // when no shown track has data, and loops at the end of the shown range.
      if (!S.scrubbing.peek()) {
        const next = playStep(S.cursorT.value ?? t0, dt, t0, t1);
        S.cursorT.value = skipGap(next, S.visible.peek(), S.offsets.peek(), t0, t1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, t0, t1]);

  // Pointer events can come faster than frames: apply at most one per frame.
  // The cursor snaps to the nearest fix of any shown track, so it never rests
  // where nothing was recorded, but it can sit in one logger's gap when
  // another logger kept going.
  const pendingT = useRef<number | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const moveCursor = (time: number, lane?: string | null) => {
    const shown = S.visible.peek();
    const on = lane ? shown.find((x) => x.id === lane) : undefined;
    if (lane !== undefined) S.laneTrack.value = on ? on.id : null;
    pendingT.current = snapTime(time, on ? [on] : shown, S.offsets.peek());
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pendingT.current !== null) S.cursorT.value = pendingT.current;
    });
  };
  /** Timeline time under a pointer, or null left of the lanes; clamped to the shown range when `clamp`. */
  const timeAt = (clientX: number, clamp = false) => {
    const el = lanesRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    let f = (clientX - r.left - LW) / Math.max(1, r.width - LW);
    if (clamp) f = Math.min(1, Math.max(0, f));
    return f < 0 || f > 1 ? null : t0 + f * (t1 - t0);
  };
  /** The track whose lane is under (or nearest to) the pointer. */
  const laneAt = (clientY: number): string | null => {
    let best: string | null = null, bd = Infinity;
    lanesRef.current?.querySelectorAll<HTMLElement>('.lane').forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
      if (d < bd) { bd = d; best = el.dataset.track ?? null; }
    });
    return best;
  };
  /** A press on a collapsed lane makes its track the selected one. */
  const pick = (lane: string | null) => {
    if (lane && lane !== S.selected.peek()?.id) S.select(lane);
  };
  // A mouse drag across the lanes picks a range to zoom into; a click moves
  // the cursor. Touch keeps dragging the cursor along.
  const drag = useRef<{ x0: number; moved: boolean } | null>(null);
  const [band, setBand] = useState<[number, number] | null>(null);
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0 || timeAt(e.clientX) === null) return;
      drag.current = { x0: e.clientX, moved: false };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const time = timeAt(e.clientX);
    if (time === null) return;
    const lane = laneAt(e.clientY);
    pick(lane);
    moveCursor(time, lane);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) {
      if (Math.abs(e.clientX - d.x0) > 4) d.moved = true;
      const r = lanesRef.current?.getBoundingClientRect();
      if (d.moved && r) {
        const lo = r.left + LW, hi = r.right;
        const a = Math.min(hi, Math.max(lo, Math.min(d.x0, e.clientX))), b = Math.min(hi, Math.max(lo, Math.max(d.x0, e.clientX)));
        setBand([a - r.left, b - r.left]);
      }
      return;
    }
    if (e.pointerType !== 'mouse' && !(e.buttons & 1)) return;
    // During playback, hovering leaves the cursor alone; a click still moves it.
    if (playing && e.pointerType === 'mouse') return;
    const time = timeAt(e.clientX);
    if (time !== null) moveCursor(time, laneAt(e.clientY));
  };
  // The scroll wheel zooms around the time under the pointer; a sideways
  // scroll (or Shift with the wheel) moves a zoomed view along. Over the lane
  // labels the page scrolls as usual.
  const onWheel = (e: WheelEvent) => {
    const el = lanesRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const at = (e.clientX - r.left - LW) / Math.max(1, r.width - LW);
    if (at < 0 || at > 1) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    const full: [number, number] = [full0, full1];
    const cur = S.timelineView.peek();
    const shown = cur && cur[0] >= full0 && cur[1] <= full1 ? cur : full;
    if (Math.abs(dx) > Math.abs(dy) || e.shiftKey) {
      if (shown !== full) S.timelineView.value = panView(shown, full, (Math.abs(dx) > Math.abs(dy) ? dx : dy) / Math.max(1, r.width - LW));
    } else {
      S.timelineView.value = wheelZoom(shown, full, at, dy);
    }
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setBand(null);
    if (!d) return;
    if (!d.moved) {
      const time = timeAt(e.clientX);
      if (time === null) return;
      const lane = laneAt(e.clientY);
      pick(lane);
      moveCursor(time, lane);
      return;
    }
    const a = timeAt(Math.min(d.x0, e.clientX), true)!, b = timeAt(Math.max(d.x0, e.clientX), true)!;
    if (b - a >= MIN_ZOOM_MS) S.timelineView.value = [a, b];
  };

  // The readout shows the track that has a fix at the cursor: the selected one, or another inside its gap.
  const cur = S.cursorItem.value;
  const selFix = cur && cur.vis ? fixAt(cur.track, S.trackTime(cur.id, cursor)) : null;
  const readout = selFix
    ? [valueText('speed', selFix.kmh), Number.isFinite(selFix.ele) ? valueText('ele', selFix.ele) : null, Number.isFinite(selFix.hdop) ? `HDOP ${valueText('hdop', selFix.hdop)}` : null, Number.isFinite(selFix.sats) ? valueText('sats', selFix.sats) : null].filter(Boolean).join(' · ')
    : '';
  const step = sel ? sel.track.derived.stats.intervalS * 1000 : 1000;
  const tickList = ticks(t0, t1, tickW, offsetMinutes(t0, z));
  // Zoomed in to ticks less than a minute apart: they show seconds.
  const tickSeconds = tickStep(t1 - t0, tickW) < 60_000;
  // Tracks that run past midnight or over several days: the readout shows the
  // date, and a tick at midnight shows the new date instead of 12:00 AM.
  const multiDay = differentDays(t0, t1, z);

  return (
    <section class="timeline" aria-label={t('timeline.label')}>
      <div class="tl-head">
        <button type="button" class="round-btn" aria-label={playing ? t('timeline.pause') : t('timeline.play')} title={playing ? t('timeline.pause') : t('timeline.play')} onClick={() => setPlaying(!playing)}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        {cur && <Badge item={cur} size="small" />}
        <span class="tl-time mono" aria-live="polite">{(multiDay ? fmtDateClock : fmtClock)(selFix ? selFix.t : cursor, z, loc)}</span>
        <span class="muted small tl-offset">{offsetLabel(cursor, z)}</span>
        {!narrow && <span class="tl-divider" />}
        {!narrow && <span class="tl-values mono">{readout}</span>}
        {!narrow && selFix && cur && !cur.track.derived.speedFromFile && <Computed text={explain.speedDerived()} />}
        <span class="grow" />
        {narrow ? (
          // One row on a phone: icons, and one time zone button.
          <>
            <button type="button" class="icon-btn outline" aria-label={zoomed ? t('map.fitZoomed') : t('map.fit')} title={zoomed ? t('map.fitZoomed') : t('map.fit')} onClick={() => mapApi.fit(zoomed ? [t0, t1] : undefined)}>
              <IconFit size={15} />
            </button>
            {zoomed && (
              <button type="button" class="icon-btn outline" aria-label={t('timeline.resetZoom')} title={t('timeline.resetZoomHint')} onClick={() => { S.timelineView.value = null; }}>
                <IconZoomReset size={15} />
              </button>
            )}
            <ZoneButton iconOnly={multiDay} />
          </>
        ) : (
          <>
            <button
              type="button" class="btn-outline small" aria-label={zoomed ? t('map.fitZoomed') : t('map.fit')} title={zoomed ? t('map.fitZoomed') : t('map.fit')}
              onClick={() => mapApi.fit(zoomed ? [t0, t1] : undefined)}
            >
              <IconFit size={14} />{t('map.fitShort')}
            </button>
            {zoomed && (
              <button type="button" class="btn-outline small" title={t('timeline.resetZoomHint')} onClick={() => { S.timelineView.value = null; }}>
                <IconZoomOut size={14} />{t('timeline.resetZoom')}
              </button>
            )}
            <ZoneButtons at={cursor} />
          </>
        )}
        <button type="button" class="icon-btn outline" aria-expanded="true" aria-label={t('timeline.hide')} title={t('timeline.hide')} onClick={() => { S.timelineMin.value = true; S.zoneOpen.value = false; }}>
          <IconChevronDown size={16} />
        </button>
      </div>
      <div
        class="tl-lanes" ref={lanesRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel}
        onPointerCancel={() => { drag.current = null; setBand(null); }} onDblClick={() => { S.timelineView.value = null; }}
      >
        {vis.map((it) => {
          const tall = it.id === sel?.id || vis.length === 1;
          const fromStart = (offsets[it.id] ?? 0) !== 0 || (it.id === refId && anyShifted);
          return (
            <Fragment key={it.id}>
              <Lane cursor={cursor} item={it} t0={t0} t1={t1} tall={tall} narrow={narrow} labelW={LW} fromStart={fromStart} />
              {tall && S.showHaloGraph.value && it.halo !== 'off' && (
                <Lane cursor={cursor} item={it} t0={t0} t1={t1} tall={false} narrow={narrow} labelW={LW} fromStart={fromStart} halo />
              )}
            </Fragment>
          );
        })}
        {raw >= 0 && raw <= 1 && <div class="tl-cursor" style={{ left: `calc(${LW}px + (100% - ${LW}px) * ${frac})` }} />}
        {band && <div class="tl-band" style={{ left: `${band[0]}px`, width: `${band[1] - band[0]}px` }} aria-hidden="true" />}
        <input
          class="sr-only" type="range" aria-label={t('timeline.scrub')} min={t0} max={t1} step={step} value={cursor}
          onInput={(e) => moveCursor(Number((e.currentTarget as HTMLInputElement).value))}
        />
      </div>
      <div class="tl-ticks" style={{ marginLeft: `${LW}px` }} aria-hidden="true">
        {tickList.map((tk) => (
          isMidnight(tk, z)
            ? <span key={tk} class="tick-date" style={{ left: `${((tk - t0) / Math.max(1, t1 - t0)) * 100}%` }}>{fmtShortDate(tk, z, loc)}</span>
            : <span key={tk} style={{ left: `${((tk - t0) / Math.max(1, t1 - t0)) * 100}%` }}>{fmtClock(tk, z, loc, tickSeconds)}</span>
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
