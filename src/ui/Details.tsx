import type { FieldKey } from '../model/types';
import * as S from '../state/store';
import { t } from '../state/store';
import { fmtBytes, fmtDistance, fmtDuration, fmtEle, fmtNum, fmtPercent, fmtSpeed } from '../format';
import { fmtClock, fmtDate, offsetLabel } from '../time/zones';
import { noteText, problemBody, problemTitle, unitOf } from './labels';
import { badgeOf } from './TrackRow';
import { IconBack, IconFlag, IconTrash, IconWarn } from './icons';
import { Computed } from './Computed';
import { explain } from './computedText';

const FIELDS: FieldKey[] = ['time', 'position', 'ele', 'speed', 'course', 'hdop', 'vdop', 'pdop', 'sats', 'fix', 'geoid', 'flags'];

/** The track's details page, inside the side panel. */
export function Details({ id }: { id: string }) {
  const item = S.items.value.find((x) => x.id === id);
  if (!item) return null;
  const tr = item.track;
  const st = tr.derived.stats;
  const loc = S.locale.value;
  const u = S.units.value;
  const z = S.zone.value;
  const km = u === 'imperial' ? t('unit.mi') : t('unit.km');
  // [label, value, how it was computed (null when it comes straight from the file)]
  const rows: [string, string, string | null][] = [
    [t('details.date'), fmtDate(st.start, z, loc), null],
    [t('details.time'), `${fmtClock(st.start, z, loc)} – ${fmtClock(st.end, z, loc)} (${offsetLabel(st.start, z)})`, null],
    [t('details.duration'), fmtDuration(st.durationS), explain.duration()],
    [t('stat.moving'), fmtDuration(st.movingS), explain.moving()],
    [t('stat.distance'), `${fmtDistance(st.distanceM, u, loc)} ${km}`, explain.distance()],
    [t('stat.avgSpeed'), `${fmtSpeed(st.avgKmh, u, loc)} ${unitOf('speed')}`, explain.avgSpeed()],
    [t('stat.maxSpeed'), `${fmtSpeed(st.maxKmh, u, loc)} ${unitOf('speed')}`, explain.maxSpeed(!tr.derived.speedFromFile)],
  ];
  if (st.climbM !== null) rows.push([t('stat.climb'), `${fmtEle(st.climbM, u, loc)} ${unitOf('ele')}`, explain.climb()]);
  if (st.minEle !== null && st.maxEle !== null) rows.push([t('stat.eleRange'), `${fmtEle(st.minEle, u, loc)}–${fmtEle(st.maxEle, u, loc)} ${unitOf('ele')}`, explain.eleRange()]);
  rows.push([t('details.fixes'), t('details.fixesValue', { n: fmtNum(tr.cols.n, loc, 0, 0), every: fmtNum(st.intervalS, loc, 1, 0) }), explain.interval()]);
  if (st.medianHdop !== null) rows.push([t('stat.medianHdop'), fmtNum(st.medianHdop, loc, 1, 1) + (tr.derived.hdopRelative ? t('measure.relativeSuffix') : ''), explain.medianHdop()]);
  if (st.medianSats !== null) rows.push([t('stat.medianSats'), fmtNum(st.medianSats, loc, 0, 0), explain.medianSats()]);
  if (st.correctedShare !== null) rows.push([t('stat.corrected'), fmtPercent(st.correctedShare, loc), explain.corrected()]);

  return (
    <div class="details">
      <div class="details-top">
        <button type="button" class="btn-outline small" onClick={() => { S.page.value = { kind: 'tracks' }; }}><IconBack />{t('common.back')}</button>
        <span class="eyebrow">{t('track.details')}</span>
      </div>
      <div class="details-title">
        <span class="badge big" style={{ background: badgeOf(item) }}>{item.id}</span>
        <span class="details-name">
          <span class="track-name">{tr.file}</span>
          <span class="track-sub">{[tr.format.toUpperCase(), fmtBytes(tr.sizeBytes, loc), tr.creator, tr.name].filter(Boolean).join(' · ')}</span>
        </span>
      </div>

      {tr.problems.length > 0 && (
        <section class="details-sec" aria-labelledby="d-problems">
          <h3 id="d-problems">{t('details.problems', { n: tr.problems.length })}</h3>
          {tr.problems.map((p, i) => (
            <div key={i} class="problem-card">
              <IconWarn size={15} />
              <div><strong>{problemTitle(p)}</strong><p>{problemBody(p)}</p></div>
            </div>
          ))}
        </section>
      )}

      <section class="details-sec" aria-labelledby="d-summary">
        <h3 id="d-summary">{t('details.summary')}</h3>
        <dl class="kv">
          {rows.map(([k, v, h]) => (<div key={k}><dt>{k}{h && <Computed text={h} />}</dt><dd>{v}</dd></div>))}
        </dl>
      </section>

      <section class="details-sec" aria-labelledby="d-fields">
        <h3 id="d-fields">{t('details.fields')}</h3>
        <ul class="chips">
          {FIELDS.map((f) => {
            const has = tr.fields.includes(f);
            return <li key={f} class={has ? 'chip is-on' : 'chip'}><span aria-hidden="true">{has ? '✓' : '–'}</span>{t(`field.${f}`)}<span class="sr-only">{has ? t('details.present') : t('details.absent')}</span></li>;
          })}
        </ul>
      </section>

      {tr.flags.length > 0 && (
        <section class="details-sec" aria-labelledby="d-flags">
          <h3 id="d-flags">{t('details.flags')}</h3>
          <ul class="flag-list">
            {tr.flags.map((f) => (
              <li key={f.n}>
                <button type="button" class="flag-btn" onClick={() => S.seek(item.id, f.t)}>
                  <IconFlag />#{f.n}<span class="mono muted">{fmtClock(f.t, z, loc)}</span>{f.name && <span class="muted">{f.name}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tr.notes.length > 0 && (
        <section class="details-sec" aria-labelledby="d-notes">
          <h3 id="d-notes">{t('details.notes')}</h3>
          <ul class="note-list">{tr.notes.map((n, i) => <li key={i}>{noteText(n)}</li>)}</ul>
        </section>
      )}

      <button type="button" class="btn-outline danger" onClick={() => S.remove(item.id)}><IconTrash />{t('details.remove')}</button>
    </div>
  );
}
