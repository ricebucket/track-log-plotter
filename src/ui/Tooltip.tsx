import * as S from '../state/store';
import { t } from '../state/store';
import { tipXY } from '../map/bridge';
import { fixAt } from '../state/inspect';
import { differentDays, fmtClock, fmtDateClock } from '../time/zones';
import { fmtNum } from '../format';
import { valueText, unitOf } from './labels';
import { badgeOf } from './TrackRow';
import { IconClose, IconFlag } from './icons';
import { ComputedMark } from './Computed';

/** The fix inspector: a card on the map at the selected track's cursor. */
export function Tooltip() {
  const xy = tipXY.value;
  const sel = S.selected.value;
  const ct = S.cursorT.value;
  if (!xy || !sel || !sel.vis || ct === null) return null;
  const f = fixAt(sel.track, S.trackTime(sel.id, ct));
  if (!f) return null;
  const loc = S.locale.value;
  // [label, value, computed by the app]
  const rows: [string, string, boolean][] = [[t('measure.speed'), valueText('speed', f.kmh), !sel.track.derived.speedFromFile]];
  if (Number.isFinite(f.ele)) rows.push([t('measure.ele'), valueText('ele', f.ele), false]);
  if (Number.isFinite(f.ellipsoid)) rows.push([t('inspect.ellipsoid'), `${fmtNum(f.ellipsoid * (S.units.value === 'imperial' ? 3.28084 : 1), loc, 0, 0)} ${unitOf('ele')}`, true]);
  if (Number.isFinite(f.grade)) rows.push([t('measure.grade'), valueText('grade', f.grade), true]);
  if (Number.isFinite(f.hdop)) rows.push(['HDOP', valueText('hdop', f.hdop) + (sel.track.derived.hdopRelative ? t('measure.relativeSuffix') : ''), false]);
  if (Number.isFinite(f.vdop)) rows.push(['VDOP', fmtNum(f.vdop, loc, 1, 1), false]);
  if (Number.isFinite(f.pdop)) rows.push(['PDOP', fmtNum(f.pdop, loc, 1, 1), false]);
  if (Number.isFinite(f.sats)) rows.push([t('measure.sats'), fmtNum(f.sats, loc, 0, 0), false]);
  if (f.fixq > 0) rows.push([t('measure.fix'), valueText('fix', f.fixq), false]);
  if (Number.isFinite(f.course)) rows.push([t('inspect.course'), `${fmtNum(f.course, loc, 0, 0)}°`, false]);
  if (Number.isFinite(f.accel)) rows.push([t('measure.accel'), valueText('accel', f.accel), true]);
  const anyComputed = rows.some((r) => r[2]);

  const others = S.visible.value.filter((x) => x.id !== sel.id).flatMap((x) => {
    const g = fixAt(x.track, S.trackTime(x.id, ct));
    return g ? [{ id: x.id, badge: badgeOf(x), text: [valueText('speed', g.kmh), Number.isFinite(g.hdop) ? `HDOP ${valueText('hdop', g.hdop)}` : null].filter(Boolean).join(' · ') }] : [];
  });

  const W = 248;
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
        {rows.map(([k, v, c]) => <div key={k}><dt>{k}{c && <ComputedMark />}</dt><dd class="mono">{v}</dd></div>)}
      </dl>
      {others.length > 0 && (
        <div class="tip-others">
          {others.map((o) => <div key={o.id}><span class="badge tiny" style={{ background: o.badge }}>{o.id}</span><span class="mono small">{o.text}</span></div>)}
        </div>
      )}
      {f.flag !== null && <div class="tip-flag"><IconFlag />{t('inspect.flag', { n: f.flag })}</div>}
      <div class="tip-source muted small">{source}</div>
      {anyComputed && <div class="tip-foot muted small"><ComputedMark />{t('computed.footnote')}</div>}
    </div>
  );
}
