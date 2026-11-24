import { Fragment } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { MeasureKey } from '../model/types';
import type { TrackItem } from '../state/logic';
import * as S from '../state/store';
import { t } from '../state/store';
import { tipXY } from '../map/bridge';
import { fixAt, hasFixNear } from '../state/inspect';
import { differentDays, fmtClock, fmtDateClock } from '../time/zones';
import { fmtNum } from '../format';
import { measureTitle, metresText, valueText, unitOf } from './labels';
import { isCombined, Use, type ComboTrack } from '../combine/combine';
import { haversine } from '../derive/geo';
import { SourceBadge, sourceNames } from './Combined';
import { Badge } from './Badge';
import { IconClose, IconFlag } from './icons';
import { Computed, hintHandlers, useHintId } from './Computed';
import { explain } from './computedText';
import { CASING, haloExtra, haloStyle, palette, UNKNOWN } from '../color/palettes';
import { drawnSteps } from '../map/geojson';

interface Row { label: string; value: string; hint: string | null; measure?: MeasureKey }

/**
 * How a measure is drawn at fix i: the line's color there (when the measure
 * is on the color) and the halo's extra width there (when it's on the halo).
 */
function drawnAt(item: TrackItem, i: number) {
  const dark = S.dark.value, single = S.single.value;
  const color = item.color === 'none' ? null : item.color;
  const halo = item.halo === 'off' ? null : item.halo;
  const stepOfFix = (key: MeasureKey) => drawnSteps(item.track, key, S.scaleFor(item.track, key))[i];
  let line = palette(item.fam, 'none', dark, single)[0];
  if (color) {
    const k = stepOfFix(color);
    line = k < 0 ? (dark ? UNKNOWN.dark : UNKNOWN.light) : palette(item.fam, color, dark, single)[k];
  }
  let haloWidth = 0;
  if (halo) {
    const k = stepOfFix(halo);
    haloWidth = k < 0 ? 0 : haloExtra(S.scaleFor(item.track, halo).steps)[k];
  }
  return { color, halo, line, haloWidth, haloStyle: haloStyle(item.fam, dark, single), casing: dark ? CASING.dark : CASING.light };
}

/** Room left between the fix card and the timeline (or the window's bottom edge). */
const CARD_GAP = 10;

/**
 * Where the fix card's top goes: a little above its fix, but no higher than
 * the top of the window, and high enough that the card ends above `floor`.
 */
export function cardTop(y: number, height: number, floor: number): number {
  return Math.max(12, Math.min(y - 40, floor - height));
}

/** The fix inspector: a card on the map at the selected track's cursor. */
export function Tooltip() {
  const medianHint = useHintId();
  const peakHint = useHintId();
  const card = useRef<HTMLDivElement>(null);
  const xy = tipXY.value;
  // Near the bottom of the map the card moves up, clear of the timeline: measured once it is drawn, before it shows.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !xy) return;
    const tl = document.querySelector('.timeline')?.getBoundingClientRect();
    const box = el.offsetParent?.getBoundingClientRect();
    const floor = (tl ? tl.top : window.innerHeight) - (box?.top ?? 0) - CARD_GAP;
    el.style.top = `${cardTop(xy.y, el.offsetHeight, floor)}px`;
  });
  // The selected track, or inside its gap the shown track that has a fix there.
  const sel = S.cursorItem.value;
  const ct = S.cursorT.value;
  if (!xy || !sel || !sel.vis || ct === null) return null;
  const f = fixAt(sel.track, S.trackTime(sel.id, ct));
  if (!f) return null;
  const loc = S.locale.value;
  // Each row: label, value, how the app worked it out (null when it's read
  // from the file), and the measure it shows, if the map can draw it.
  const rows: Row[] = [{ label: t('measure.speed'), value: valueText('speed', f.kmh), hint: isCombined(sel.track) ? t('computed.combinedSpeed') : sel.track.derived.speedFromFile ? null : explain.speedDerived(), measure: 'speed' }];
  if (Number.isFinite(f.ele)) rows.push({ label: t('measure.ele'), value: valueText('ele', f.ele), hint: null, measure: 'ele' });
  if (Number.isFinite(f.ellipsoid)) rows.push({ label: t('inspect.ellipsoid'), value: `${fmtNum(f.ellipsoid * (S.units.value === 'imperial' ? 3.28084 : 1), loc, 0, 0)} ${unitOf('ele')}`, hint: explain.ellipsoid() });
  if (Number.isFinite(f.grade)) rows.push({ label: t('measure.grade'), value: valueText('grade', f.grade), hint: explain.grade(), measure: 'grade' });
  if (Number.isFinite(f.hdop)) rows.push({ label: 'HDOP', value: valueText('hdop', f.hdop) + (sel.track.derived.hdopRelative ? t('measure.relativeSuffix') : ''), hint: null, measure: 'hdop' });
  if (Number.isFinite(f.vdop)) rows.push({ label: 'VDOP', value: fmtNum(f.vdop, loc, 1, 1), hint: null });
  if (Number.isFinite(f.pdop)) rows.push({ label: 'PDOP', value: fmtNum(f.pdop, loc, 1, 1), hint: null });
  if (Number.isFinite(f.sats)) rows.push({ label: t('measure.sats'), value: fmtNum(f.sats, loc, 0, 0), hint: null, measure: 'sats' });
  if (f.fixq > 0) rows.push({ label: t('measure.fix'), value: valueText('fix', f.fixq), hint: null, measure: 'fix' });
  if (Number.isFinite(f.course)) rows.push({ label: t('inspect.course'), value: `${fmtNum(f.course, loc, 0, 0)}°`, hint: null });
  // Acceleration: a heading, then (below) every reading of the fix's second,
  // lowest first. Two are highlighted: the strongest, which the map and the
  // timeline color the second by, and the median (with an even count, the
  // upper of the two middle readings). A second with very many readings lists
  // only some, spread from the lowest to the strongest, with the median of
  // them all in the middle and a count of the rest.
  const rd = f.readings, more = f.moreReadings, total = rd.length + more;
  const mid = rd.length >> 1, even = total % 2 === 0, peak = rd.length - 1;
  if (rd.length) rows.push({ label: measureTitle('accel'), value: '', hint: explain.accel(), measure: 'accel' });
  else if (Number.isFinite(f.accel)) rows.push({ label: t('measure.accel'), value: valueText('accel', f.accel), hint: explain.accel(), measure: 'accel' });
  // The measures on the color and the halo are highlighted, each marked with
  // how it looks on the map at this fix.
  const look = drawnAt(sel, f.i);
  const medianText = even ? t('inspect.medianHintEven', { n: total, v: valueText('accel', rd[mid]) }) : t('inspect.medianHint', { n: total, v: valueText('accel', rd[mid]) });
  const medianTip = hintHandlers(medianHint, medianText, t('inspect.medianTitle'));
  const peakTip = hintHandlers(peakHint, t('inspect.peakHint', { n: total, v: valueText('accel', rd[peak]) }), t('inspect.peakTitle'));
  // All of the second's readings, or (very many of them) the ones listed out of how many.
  const readingsText = more > 0 ? t('inspect.readingsSome', { shown: rd.length, n: fmtNum(total, loc, 0, 0) }) : t('inspect.readings', { n: total });

  const others = S.visible.value.filter((x) => x.id !== sel.id).flatMap((x) => {
    // A track with no fix near this moment (in a gap, or before or after it) says so, rather than showing a fix far away.
    const at = S.trackTime(x.id, ct);
    if (!hasFixNear(x.track, at)) return [{ id: x.id, item: x, text: t('inspect.noFix') }];
    const g = fixAt(x.track, at);
    return g ? [{ id: x.id, item: x, text: [valueText('speed', g.kmh), Number.isFinite(g.hdop) ? `HDOP ${valueText('hdop', g.hdop)}` : null].filter(Boolean).join(' · ') }] : [];
  });

  const W = 236;
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const left = xy.x + 22 + W > vw - 16 ? xy.x - 22 - W : xy.x + 22;
  const source = sel.track.format === 'nmea'
    ? (f.line === f.lineEnd ? t('inspect.line', { a: f.line }) : t('inspect.lines', { a: f.line, b: f.lineEnd }))
    : t('inspect.point', { a: f.i + 1, line: f.line });

  return (
    <div class="tooltip" ref={card} data-x={Math.round(xy.x)} data-y={Math.round(xy.y)} style={{ left: `${left}px`, top: `${Math.max(12, xy.y - 40)}px`, width: `${W}px` }} role="status" aria-live="off">
      <div class="tip-head">
        <Badge item={sel} size="small" />
        <span class="mono tip-time">{(differentDays(sel.track.derived.stats.start, sel.track.derived.stats.end, S.zone.value) ? fmtDateClock : fmtClock)(f.t, S.zone.value, loc)}</span>
        <button type="button" class="icon-btn tip-close" aria-label={t('common.close')} title={t('common.close')} onClick={() => S.clearCursor()}><IconClose size={14} /></button>
      </div>
      <dl class="tip-rows">
        {rows.map(({ label: k, value: v, hint, measure }) => {
          const asColor = measure !== undefined && measure === look.color;
          const asHalo = measure !== undefined && measure === look.halo;
          return (
          <Fragment key={k}>
            <div class={asColor || asHalo ? 'is-drawn' : undefined}>
              <dt>
                {asColor && <span class="tip-swatch" style={{ backgroundColor: look.line }} title={t('inspect.colorHere')} />}
                {asHalo && (
                  <span class="tip-halo" title={t('inspect.haloHere')}>
                    <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
                      <path d="M4 8H16" stroke={look.haloStyle.color} stroke-opacity={Math.min(1, look.haloStyle.opacity * 2.4)} stroke-width={6.5 + look.haloWidth * 0.35} stroke-linecap="round" />
                      <path d="M4 8H16" stroke={look.casing} stroke-width="4.2" stroke-linecap="round" />
                      <path d="M4 8H16" stroke={look.line} stroke-width="2.6" stroke-linecap="round" />
                    </svg>
                  </span>
                )}
                {k}
                {(asColor || asHalo) && <span class="sr-only">{asColor && asHalo ? t('inspect.asBoth') : asColor ? t('inspect.asColor') : t('inspect.asHalo')}</span>}
                {hint && <Computed text={hint} />}
              </dt>
              <dd class="mono">{v}</dd>
            </div>
            {k === measureTitle('accel') && rd.length > 0 && (
              <div>
                <dt class="sr-only">{readingsText}</dt>
                <dd class="tip-readings" title={readingsText}>
                  {rd.map((g, j) => (j === peak
                    ? <span key={j} class="is-peak" {...peakTip}>{fmtNum(g, loc, 2, 2)}</span>
                    : j === mid
                      ? <span key={j} class="is-median" {...medianTip}>{fmtNum(g, loc, 2, 2)}</span>
                      : <span key={j}>{fmtNum(g, loc, 2, 2)}</span>))}
                  {more > 0 && <span class="tip-more">{t('inspect.moreReadings', { n: fmtNum(more, loc, 0, 0) })}</span>}
                </dd>
              </div>
            )}
          </Fragment>
          );
        })}
        {/* Decimal degrees: 5 places is about a meter, and pastes into map search boxes. */}
        <div class="tip-coords"><dt>{t('inspect.position')}</dt><dd class="mono coords">{f.lat.toFixed(5)}, {f.lon.toFixed(5)}</dd></div>
      </dl>
      {isCombined(sel.track) && Number.isFinite(f.ele) && sel.track.combo.eleOffset && <div class="tip-amber">{eleOffsetText(sel.track.combo.eleOffset, sourceNames(sel, sel.track))}</div>}
      {isCombined(sel.track) && <LogRows track={sel.track} names={sourceNames(sel, sel.track)} i={f.i} />}
      {others.length > 0 && (
        <div class="tip-others">
          {others.map((o) => <div key={o.id}><Badge item={o.item} size="tiny" /><span class="mono small">{o.text}</span></div>)}
        </div>
      )}
      {f.flag !== null && <div class="tip-flag"><IconFlag />{t('inspect.flag', { n: f.flag })}</div>}
      {/* A combined track has no file to point into. */}
      {!isCombined(sel.track) && <div class="tip-source muted small">{source}</div>}
    </div>
  );
}

/** A steady height difference between two logs, worked out but not applied: "log 2 reads 32 m lower than log 1 throughout". */
export function eleOffsetText(o: { from: number; to: number; m: number }, names: readonly string[]): string {
  const p = { a: names[o.from], b: names[o.to], m: metresText(Math.abs(o.m)) };
  return o.m < 0 ? t('combine.eleLower', p) : t('combine.eleHigher', p);
}

/** Where each of a combined track's logs is at this point: how far away, or why it doesn't count. */
function LogRows({ track, names, i }: { track: ComboTrack; names: readonly string[]; i: number }) {
  const { combo, cols } = track;
  return (
    <ul class="tip-logs">
      {combo.sources.map((_, k) => {
        const la = combo.srcLat[k][i], lo = combo.srcLon[k][i], u = combo.use[k][i];
        const d = la === la ? metresText(haversine(cols.lat[i], cols.lon[i], la, lo)) : '';
        const text = u === Use.LeftOut ? t('inspect.logOut', { d })
          : u === Use.Idle ? t('inspect.logIdle')
          : la !== la ? t('inspect.logNone')
          : t('inspect.logAway', { d });
        return <li key={k} class={u === Use.LeftOut ? 'is-out' : undefined} data-log={names[k]}><SourceBadge track={track} k={k} name={names[k]} size="tiny" /><span><span class="sr-only">{t('combine.logLabel', { k: names[k] })}{t('label.sep')}</span>{text}</span></li>;
      })}
    </ul>
  );
}
