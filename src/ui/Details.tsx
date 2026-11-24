import type { FieldKey, SpeedUnit } from '../model/types';
import * as S from '../state/store';
import { t } from '../state/store';
import { fmtDistance, fmtDuration, fmtEle, fmtNum, fmtPercent, fmtSpeed } from '../format';
import { differentDays, fmtClock, fmtDate, fmtDateClock, localZoneId, offsetLabel, zoneCity } from '../time/zones';
import { trackName, type TrackItem } from '../state/logic';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { formatName, noteText, originalName, problemBody, problemTitle, trackTagline, unitOf } from './labels';
import { Badge } from './Badge';
import { IconBack, IconChevronRight, IconFlag, IconWarn } from './icons';
import { Computed } from './Computed';
import { explain } from './computedText';
import { isCombined, type ComboTrack } from '../combine/combine';
import { SourceBadge, sourceNames, sourceTitles } from './Combined';
import { focusAfterRender, rowButton } from './hooks';
import { SPEED_UNITS } from '../parse/units';

/**
 * For files whose times have no time zone: which zone they're read in. The
 * clock readings stay as written; picking a zone moves the whole track.
 */
function ClockZone({ item }: { item: TrackItem }) {
  const tr = item.track;
  const z = tr.clock ?? 'utc';
  const t0 = tr.cols.t[0];
  const open = S.clockPicker.value === item.id;
  useEffect(() => () => { if (S.clockPicker.peek() === item.id) S.clockPicker.value = null; }, [item.id]);
  const label = z === 'local' ? t('clock.local', { zone: zoneCity(localZoneId()), offset: offsetLabel(t0, 'local') })
    : z === 'utc' ? 'UTC' : `${zoneCity(z)} (${offsetLabel(t0, z)})`;
  return (
    <section class="details-sec" aria-labelledby="d-clock">
      <h3 id="d-clock">{t('details.clock')}</h3>
      <p class="muted small clock-note">{t('details.clockNote')}</p>
      <button
        type="button" class={`measure-btn${open ? ' is-open' : ''}`} data-clock-trigger aria-haspopup="dialog" aria-expanded={open ? 'true' : 'false'}
        onClick={() => { S.clockPicker.value = open ? null : item.id; }}
      >
        <span class="measure-value">{label}</span>
        <IconChevronRight />
      </button>
    </section>
  );
}

/**
 * For files whose speeds don't say their unit: which unit they're read in
 * (the one the positions point to, else m/s). Picking another reads every
 * speed again in it.
 */
function SpeedUnitPick({ id, unit }: { id: string; unit: SpeedUnit }) {
  return (
    <section class="details-sec" aria-labelledby="d-speed-unit">
      <h3 id="d-speed-unit">{t('details.speedUnit')}</h3>
      <p class="muted small clock-note">{t('details.speedUnitNote')}</p>
      {/* As wide as its buttons: the section would stretch it across. */}
      <div class="seg" role="group" aria-labelledby="d-speed-unit">
        {SPEED_UNITS.map((u) => (
          <button key={u} type="button" aria-pressed={u === unit ? 'true' : 'false'} onClick={() => S.setSpeedUnit(id, u)}>{t(`unit.${u}`)}</button>
        ))}
      </div>
    </section>
  );
}

const FIELDS: FieldKey[] = ['time', 'position', 'ele', 'speed', 'course', 'hdop', 'vdop', 'pdop', 'sats', 'fix', 'geoid', 'accel', 'flags'];

/**
 * The page's top line: Back, which returns the keyboard to the Properties
 * button of the track's card (or, with the card closed, to its row).
 */
function DetailsTop({ id }: { id: string }) {
  const back = useRef<HTMLButtonElement>(null);
  // Opening the page takes the keyboard along to it: the button that opened it is gone.
  useLayoutEffect(() => { back.current?.focus(); }, [id]);
  const goBack = () => {
    focusAfterRender(() => document.getElementById(`tlp-props-${id}`) ?? rowButton(id));
    S.page.value = { kind: 'tracks' };
  };
  return (
    <div class="details-top">
      <button ref={back} type="button" class="btn-outline small" onClick={goBack}><IconBack />{t('common.back')}</button>
      <span class="eyebrow">{t('track.details')}</span>
    </div>
  );
}

/** The track's properties page, inside the side panel. */
export function Details({ id }: { id: string }) {
  const item = S.items.value.find((x) => x.id === id);
  // A track that is gone has no properties to show, but the page still has its way back.
  if (!item) return <div class="details"><DetailsTop id={id} /></div>;
  const tr = item.track;
  const st = tr.derived.stats;
  const speedUnit = S.inferredUnit(tr)?.unit;
  const loc = S.locale.value;
  const u = S.units.value;
  const z = S.zone.value;
  const km = u === 'imperial' ? t('unit.mi') : t('unit.km');
  // A track over more than one day shows both dates.
  const multiDay = differentDays(st.start, st.end, z);
  const clock = multiDay ? fmtDateClock : fmtClock;
  // [label, value, how it was computed (null when it comes straight from the file)]
  const rows: [string, string, string | null][] = [
    [t('details.date'), multiDay ? `${fmtDate(st.start, z, loc)} – ${fmtDate(st.end, z, loc)}` : fmtDate(st.start, z, loc), null],
    [t('details.time'), `${clock(st.start, z, loc)} – ${clock(st.end, z, loc)} (${offsetLabel(st.start, z)})`, null],
    [t('details.duration'), fmtDuration(st.durationS), explain.duration()],
    [t('stat.moving'), fmtDuration(st.movingS), explain.moving()],
    [t('stat.distance'), `${fmtDistance(st.distanceM, u, loc)} ${km}`, explain.distance()],
    [t('stat.avgSpeed'), `${fmtSpeed(st.avgKmh, u, loc)} ${unitOf('speed')}`, explain.avgSpeed()],
    [t('stat.maxSpeed'), `${fmtSpeed(st.maxKmh, u, loc)} ${unitOf('speed')}`, isCombined(tr) ? t('computed.combinedSpeed') : explain.maxSpeed(!tr.derived.speedFromFile)],
  ];
  if (st.climbM !== null) rows.push([t('stat.climb'), `${fmtEle(st.climbM, u, loc)} ${unitOf('ele')}`, explain.climb()]);
  if (st.minEle !== null && st.maxEle !== null) rows.push([t('stat.eleRange'), `${fmtEle(st.minEle, u, loc)}–${fmtEle(st.maxEle, u, loc)} ${unitOf('ele')}`, explain.eleRange()]);
  rows.push([t('details.fixes'), t('details.fixesValue', { n: fmtNum(tr.cols.n, loc, 0, 0), every: fmtNum(st.intervalS, loc, 1, 0) }), explain.interval()]);
  if (st.medianHdop !== null) rows.push([t('stat.medianHdop'), fmtNum(st.medianHdop, loc, 1, 1) + (tr.derived.hdopRelative ? t('measure.relativeSuffix') : ''), explain.medianHdop()]);
  if (st.medianSats !== null) rows.push([t('stat.medianSats'), fmtNum(st.medianSats, loc, 0, 0), explain.medianSats()]);
  if (st.maxAccel !== null) rows.push([t('stat.maxAccel'), `${fmtNum(st.maxAccel, loc, 2, 2)} ${t('unit.g')}`, explain.accel()]);
  if (st.correctedShare !== null) rows.push([t('stat.corrected'), fmtPercent(st.correctedShare, loc), explain.corrected()]);

  return (
    <div class="details">
      <DetailsTop id={id} />
      <div class="details-title">
        <Badge item={item} size="big" />
        <span class="details-name">
          <span class="track-name">{trackName(item)}</span>
          {/* Renamed: the name it came with too. */}
          {item.customName !== undefined && <span class="details-orig">{originalName(tr)}</span>}
          <span class="track-sub">{trackTagline(tr)}</span>
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

      {tr.clock && <ClockZone item={item} />}
      {speedUnit && <SpeedUnitPick id={item.id} unit={speedUnit} />}

      <section class="details-sec" aria-labelledby="d-summary">
        <h3 id="d-summary">{t('details.summary')}</h3>
        <dl class="kv">
          {rows.map(([k, v, h]) => (<div key={k}><dt>{k}{h && <Computed text={h} />}</dt><dd>{v}</dd></div>))}
        </dl>
        {/* Next to the elevation figures: a steady difference between the logs' heights, not applied. */}
        {isCombined(tr) && tr.combo.eleOffset && <p class="amber-note">{eleOffsetNote(tr.combo.eleOffset, sourceNames(item, tr))}</p>}
      </section>
      {isCombined(tr) && <CombinedSections track={tr} names={sourceNames(item, tr)} titles={sourceTitles(item, tr)} />}

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
                  <IconFlag />#{f.n}<span class="mono muted">{clock(f.t, z, loc)}</span>{f.name && <span class="muted">{f.name}</span>}
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

    </div>
  );
}

function eleOffsetNote(o: { from: number; to: number; m: number }, names: readonly string[]): string {
  return t('details.eleOffset', { a: names[o.from], b: names[o.to], m: `${fmtEle(Math.abs(o.m), S.units.value, S.locale.value)} ${unitOf('ele')}`, dir: o.m < 0 ? t('details.lower') : t('details.higher') });
}

/** A combined track's logs, and how far each clock was moved to line up with the one that kept its own. */
function CombinedSections({ track, names, titles }: { track: ComboTrack; names: readonly string[]; titles: readonly string[] }) {
  const loc = S.locale.value;
  const { sources, ref } = track.combo;
  const clock = (k: number, s: number) => {
    const p = { k: names[k], r: names[ref], s: fmtNum(Math.abs(s), loc, 1, 1) };
    return s > 0 ? t('details.clockFast', p) : s < 0 ? t('details.clockSlow', p) : t('details.clockSame', p);
  };
  return (
    <>
      <section class="details-sec" aria-labelledby="d-logs">
        <h3 id="d-logs">{t('details.logs')}</h3>
        <ul class="combo-logs details-logs">
          {sources.map((s, k) => (
            <li key={k} data-log={names[k]}>
              <SourceBadge track={track} k={k} name={names[k]} />
              <span class="combo-log">
                <span class="combo-file">{titles[k]}</span>
                <span class="combo-sub">{[formatName(s.track.format), t('details.fixesValue', { n: fmtNum(s.track.cols.n, loc, 0, 0), every: fmtNum(s.track.derived.stats.intervalS, loc, 1, 0) })].join(' · ')}</span>
              </span>
            </li>
          ))}
        </ul>
        <p class="muted small">{t('details.logsNote')}</p>
      </section>
      <section class="details-sec" aria-labelledby="d-clocks">
        <h3 id="d-clocks">{t('details.clocks')}</h3>
        <ul class="note-list">{sources.map((s, k) => (k === ref ? null : <li key={k}>{clock(k, s.clockS)}</li>))}</ul>
      </section>
    </>
  );
}
