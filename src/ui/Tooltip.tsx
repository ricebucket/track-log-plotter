import { Fragment } from 'preact';
import * as S from '../state/store';
import { t } from '../state/store';
import { tipXY } from '../map/bridge';
import { fixAt } from '../state/inspect';
import { differentDays, fmtClock, fmtDateClock } from '../time/zones';
import { fmtNum } from '../format';
import { valueText, unitOf } from './labels';
import { badgeOf } from './TrackRow';
import { IconClose, IconFlag } from './icons';
import { Computed } from './Computed';
import { explain } from './computedText';

/** The fix inspector: a card on the map at the selected track's cursor. */
export function Tooltip() {
  const xy = tipXY.value;
  // The selected track, or inside its gap the shown track that has a fix there.
  const sel = S.cursorItem.value;
  const ct = S.cursorT.value;
  if (!xy || !sel || !sel.vis || ct === null) return null;
  const f = fixAt(sel.track, S.trackTime(sel.id, ct));
  if (!f) return null;
  const loc = S.locale.value;
  // [label, value, computed by the app]
  // [label, value, how the app worked it out (null when it's read from the file)]
  const rows: [string, string, string | null][] = [[t('measure.speed'), valueText('speed', f.kmh), sel.track.derived.speedFromFile ? null : explain.speedDerived()]];
  if (Number.isFinite(f.ele)) rows.push([t('measure.ele'), valueText('ele', f.ele), null]);
  if (Number.isFinite(f.ellipsoid)) rows.push([t('inspect.ellipsoid'), `${fmtNum(f.ellipsoid * (S.units.value === 'imperial' ? 3.28084 : 1), loc, 0, 0)} ${unitOf('ele')}`, explain.ellipsoid()]);
  if (Number.isFinite(f.grade)) rows.push([t('measure.grade'), valueText('grade', f.grade), explain.grade()]);
  if (Number.isFinite(f.hdop)) rows.push(['HDOP', valueText('hdop', f.hdop) + (sel.track.derived.hdopRelative ? t('measure.relativeSuffix') : ''), null]);
  if (Number.isFinite(f.vdop)) rows.push(['VDOP', fmtNum(f.vdop, loc, 1, 1), null]);
  if (Number.isFinite(f.pdop)) rows.push(['PDOP', fmtNum(f.pdop, loc, 1, 1), null]);
  if (Number.isFinite(f.sats)) rows.push([t('measure.sats'), fmtNum(f.sats, loc, 0, 0), null]);
  if (f.fixq > 0) rows.push([t('measure.fix'), valueText('fix', f.fixq), null]);
  if (Number.isFinite(f.course)) rows.push([t('inspect.course'), `${fmtNum(f.course, loc, 0, 0)}°`, null]);
  // Acceleration: the median of the fix's second, then (below) all its readings, lowest first.
  const rd = f.readings, mid = rd.length >> 1, even = rd.length % 2 === 0;
  const median = rd.length ? (even ? (rd[mid - 1] + rd[mid]) / 2 : rd[mid]) : NaN;
  if (Number.isFinite(median)) rows.push([t('measure.accel'), t('inspect.median', { v: valueText('accel', median) }), explain.accel()]);
  else if (Number.isFinite(f.accel)) rows.push([t('measure.accel'), valueText('accel', f.accel), explain.accel()]);
  // Latitude and longitude in decimal degrees: 5 places is about a meter, and pastes into map search boxes.
  rows.push([t('inspect.position'), `${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}`, null]);

  const others = S.visible.value.filter((x) => x.id !== sel.id).flatMap((x) => {
    const g = fixAt(x.track, S.trackTime(x.id, ct));
    return g ? [{ id: x.id, badge: badgeOf(x), text: [valueText('speed', g.kmh), Number.isFinite(g.hdop) ? `HDOP ${valueText('hdop', g.hdop)}` : null].filter(Boolean).join(' · ') }] : [];
  });

  const W = 284;
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const left = xy.x + 22 + W > vw - 16 ? xy.x - 22 - W : xy.x + 22;
  const source = sel.track.format === 'nmea'
    ? (f.line === f.lineEnd ? t('inspect.line', { a: f.line }) : t('inspect.lines', { a: f.line, b: f.lineEnd }))
    : t('inspect.point', { a: f.i + 1, line: f.line });

  return (
    <div class="tooltip" data-x={Math.round(xy.x)} data-y={Math.round(xy.y)} style={{ left: `${left}px`, top: `${Math.max(12, xy.y - 40)}px`, width: `${W}px` }} role="status" aria-live="off">
      <div class="tip-head">
        <span class="badge small" style={{ background: badgeOf(sel) }}>{sel.id}</span>
        <span class="mono tip-time">{(differentDays(sel.track.derived.stats.start, sel.track.derived.stats.end, S.zone.value) ? fmtDateClock : fmtClock)(f.t, S.zone.value, loc)}</span>
        <button type="button" class="icon-btn tip-close" aria-label={t('common.close')} title={t('common.close')} onClick={() => S.clearCursor()}><IconClose size={14} /></button>
      </div>
      <dl class="tip-rows">
        {rows.map(([k, v, hint]) => (
          <Fragment key={k}>
            <div><dt>{k}{hint && <Computed text={hint} />}</dt><dd class="mono">{v}</dd></div>
            {k === t('measure.accel') && rd.length > 0 && (
              <div>
                <dt class="sr-only">{t('inspect.readings', { n: rd.length })}</dt>
                <dd class="tip-readings" title={t('inspect.readings', { n: rd.length })}>
                  {rd.map((g, j) => <span key={j} class={j === mid || (even && j === mid - 1) ? 'is-median' : undefined}>{fmtNum(g, loc, 2, 2)}</span>)}
                </dd>
              </div>
            )}
          </Fragment>
        ))}
      </dl>
      {others.length > 0 && (
        <div class="tip-others">
          {others.map((o) => <div key={o.id}><span class="badge tiny" style={{ background: o.badge }}>{o.id}</span><span class="mono small">{o.text}</span></div>)}
        </div>
      )}
      {f.flag !== null && <div class="tip-flag"><IconFlag />{t('inspect.flag', { n: f.flag })}</div>}
      <div class="tip-source muted small">{source}</div>
    </div>
  );
}
