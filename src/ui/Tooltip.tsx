import { Fragment } from 'preact';
import type { MeasureKey } from '../model/types';
import type { TrackItem } from '../state/logic';
import * as S from '../state/store';
import { t } from '../state/store';
import { tipXY } from '../map/bridge';
import { fixAt } from '../state/inspect';
import { differentDays, fmtClock, fmtDateClock } from '../time/zones';
import { fmtNum } from '../format';
import { measureTitle, valueText, unitOf } from './labels';
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

/** The fix inspector: a card on the map at the selected track's cursor. */
export function Tooltip() {
  const medianHint = useHintId();
  const peakHint = useHintId();
  const xy = tipXY.value;
  // The selected track, or inside its gap the shown track that has a fix there.
  const sel = S.cursorItem.value;
  const ct = S.cursorT.value;
  if (!xy || !sel || !sel.vis || ct === null) return null;
  const f = fixAt(sel.track, S.trackTime(sel.id, ct));
  if (!f) return null;
  const loc = S.locale.value;
  // Each row: label, value, how the app worked it out (null when it's read
  // from the file), and the measure it shows, if the map can draw it.
  const rows: Row[] = [{ label: t('measure.speed'), value: valueText('speed', f.kmh), hint: sel.track.derived.speedFromFile ? null : explain.speedDerived(), measure: 'speed' }];
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
  // upper of the two middle readings).
  const rd = f.readings, mid = rd.length >> 1, even = rd.length % 2 === 0, peak = rd.length - 1;
  if (rd.length) rows.push({ label: measureTitle('accel'), value: '', hint: explain.accel(), measure: 'accel' });
  else if (Number.isFinite(f.accel)) rows.push({ label: t('measure.accel'), value: valueText('accel', f.accel), hint: explain.accel(), measure: 'accel' });
  // The measures on the color and the halo are highlighted, each marked with
  // how it looks on the map at this fix.
  const look = drawnAt(sel, f.i);
  const medianText = even ? t('inspect.medianHintEven', { n: rd.length, v: valueText('accel', rd[mid]) }) : t('inspect.medianHint', { n: rd.length, v: valueText('accel', rd[mid]) });
  const medianTip = hintHandlers(medianHint, medianText, t('inspect.medianTitle'));
  const peakTip = hintHandlers(peakHint, t('inspect.peakHint', { n: rd.length, v: valueText('accel', rd[peak]) }), t('inspect.peakTitle'));

  const others = S.visible.value.filter((x) => x.id !== sel.id).flatMap((x) => {
    const g = fixAt(x.track, S.trackTime(x.id, ct));
    return g ? [{ id: x.id, item: x, text: [valueText('speed', g.kmh), Number.isFinite(g.hdop) ? `HDOP ${valueText('hdop', g.hdop)}` : null].filter(Boolean).join(' · ') }] : [];
  });

  const W = 236;
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const left = xy.x + 22 + W > vw - 16 ? xy.x - 22 - W : xy.x + 22;
  const source = sel.track.format === 'nmea'
    ? (f.line === f.lineEnd ? t('inspect.line', { a: f.line }) : t('inspect.lines', { a: f.line, b: f.lineEnd }))
    : t('inspect.point', { a: f.i + 1, line: f.line });

  return (
    <div class="tooltip" data-x={Math.round(xy.x)} data-y={Math.round(xy.y)} style={{ left: `${left}px`, top: `${Math.max(12, xy.y - 40)}px`, width: `${W}px` }} role="status" aria-live="off">
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
                <dt class="sr-only">{t('inspect.readings', { n: rd.length })}</dt>
                <dd class="tip-readings" title={t('inspect.readings', { n: rd.length })}>
                  {rd.map((g, j) => (j === peak
                    ? <span key={j} class="is-peak" {...peakTip}>{fmtNum(g, loc, 2, 2)}</span>
                    : j === mid
                      ? <span key={j} class="is-median" {...medianTip}>{fmtNum(g, loc, 2, 2)}</span>
                      : <span key={j}>{fmtNum(g, loc, 2, 2)}</span>))}
                </dd>
              </div>
            )}
          </Fragment>
          );
        })}
        {/* Decimal degrees: 5 places is about a meter, and pastes into map search boxes. */}
        <div class="tip-coords"><dt>{t('inspect.position')}</dt><dd class="mono coords">{f.lat.toFixed(5)}, {f.lon.toFixed(5)}</dd></div>
      </dl>
      {others.length > 0 && (
        <div class="tip-others">
          {others.map((o) => <div key={o.id}><Badge item={o.item} size="tiny" /><span class="mono small">{o.text}</span></div>)}
        </div>
      )}
      {f.flag !== null && <div class="tip-flag"><IconFlag />{t('inspect.flag', { n: f.flag })}</div>}
      <div class="tip-source muted small">{source}</div>
    </div>
  );
}
