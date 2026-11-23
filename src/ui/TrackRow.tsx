import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MeasureKey } from '../model/types';
import type { TrackItem } from '../state/logic';
import * as S from '../state/store';
import { t } from '../state/store';
import { palette, haloExtra, haloStyle, CASING } from '../color/palettes';
import { Badge } from './Badge';
import { timeShares, type Scale } from '../color/scale';
import { fmtDistance, fmtDuration, fmtPercent, fmtSpeed } from '../format';
import { differentDays, fmtShortDate } from '../time/zones';
import { formatName, measureName, measureTitle, stepLabels, unitOf } from './labels';
import { IconCheck, IconChevronRight, IconCopy, IconDoc, IconEye, IconEyeOff, IconTrash, IconWarn } from './icons';
import { Computed } from './Computed';
import { explain } from './computedText';
import { fullTextIfCut } from './cutText';
import { CombinedLogs } from './Combined';
import { isCombined } from '../combine/combine';

export { badgeOf } from './Badge';

export function TrackRow({ item }: { item: TrackItem }) {
  const sel = S.selected.value?.id === item.id;
  // A newly added track scrolls into view, so its open card isn't left below the fold.
  const row = useRef<HTMLDivElement>(null);
  const revealing = S.reveal.value === item.id;
  useLayoutEffect(() => {
    if (!revealing) return;
    if (sel) row.current?.scrollIntoView({ block: 'nearest' });
    S.reveal.value = null;
  }, [revealing]);
  const tr = item.track;
  const st = tr.derived.stats;
  const loc = S.locale.value;
  const u = S.units.value;
  const ramp = palette(item.fam, item.color, S.dark.value, S.single.value && item.vis);
  const problems = tr.problems.length;
  const sub = [
    differentDays(st.start, st.end, S.zone.value)
      ? `${fmtShortDate(st.start, S.zone.value, loc)} – ${fmtShortDate(st.end, S.zone.value, loc)}`
      : fmtShortDate(st.start, S.zone.value, loc),
    `${fmtDistance(st.distanceM, u, loc)} ${u === 'imperial' ? t('unit.mi') : t('unit.km')}`,
    // A combined track: its diamond and name say so; the line says how many logs.
    isCombined(tr) ? t('combine.logs', { n: tr.combo.sources.length }) : formatName(tr.format),
  ].join(' · ');
  // In select mode the eye is a tick box, and the whole row ticks it.
  const selecting = S.selecting.value;
  const tick = selecting && S.ticked.value.includes(item.id);

  return (
    <div ref={row} class={`track-row${sel && !selecting ? ' is-selected' : ''}${item.vis ? '' : ' is-hidden'}${tick ? ' is-ticked' : ''}`} data-track={item.id}>
      <div class="track-row-head">
        {selecting ? (
          // The row itself is the checkbox for assistive tech; this box is what it looks like.
          <span class={`tick-box${tick ? ' is-on' : ''}`} aria-hidden="true" onClick={() => S.toggleTick(item.id)}>{tick && <IconCheck size={13} />}</span>
        ) : (
          <button
            type="button" class="icon-btn eye" aria-pressed={item.vis ? 'true' : 'false'}
            aria-label={item.vis ? t('track.hide', { id: item.id }) : t('track.show', { id: item.id })}
            title={item.vis ? t('track.hide', { id: item.id }) : t('track.show', { id: item.id })}
            onClick={() => S.toggleVisible(item.id)}
          >
            {item.vis ? <IconEye /> : <IconEyeOff />}
          </button>
        )}
        <button
          type="button" class="track-main" {...(selecting ? { role: 'checkbox', 'aria-checked': tick ? 'true' : 'false', 'aria-label': `${t('select.track', { id: item.id })}: ${tr.file}` } : { 'aria-expanded': sel ? 'true' : 'false' })}
          onClick={() => (selecting ? S.toggleTick(item.id) : S.select(item.id))}
        >
          <Badge item={item} />
          <span class="track-text">
            <span class="track-name" onMouseEnter={fullTextIfCut(tr.file)}>{tr.file}</span>
            <span class="track-sub" title={`${t('stat.distance')}: ${explain.distance()}`}>{sub}</span>
            {problems > 0 && (
              <span class="problem-badge"><IconWarn size={11} />{t('track.problems', { n: problems })}</span>
            )}
          </span>
          <span class="ramp" aria-hidden="true">
            {ramp.map((c, i) => <span key={i} style={{ background: c }} />)}
          </span>
        </button>
      </div>
      {S.limitNotice.value === item.id && (
        <div class="notice" role="status"><IconWarn size={14} /><span>{t('track.limit')}</span></div>
      )}
      {sel && !selecting && <TrackDetailsInline item={item} />}
    </div>
  );
}

function TrackDetailsInline({ item }: { item: TrackItem }) {
  const st = item.track.derived.stats;
  const detailsLabel = item.track.clock ? t('track.detailsClock') : t('track.details');
  const loc = S.locale.value;
  const u = S.units.value;
  const stats = [
    { label: t('stat.distance'), value: fmtDistance(st.distanceM, u, loc), unit: u === 'imperial' ? t('unit.mi') : t('unit.km'), hint: explain.distance() },
    { label: t('stat.moving'), value: fmtDuration(st.movingS), unit: '', hint: explain.moving() },
    { label: t('stat.avgSpeed'), value: fmtSpeed(st.avgKmh, u, loc), unit: unitOf('speed'), hint: explain.avgSpeed() },
  ];
  return (
    <div class="track-inline">
      <dl class="stats">
        {stats.map((s) => (
          <div key={s.label}>
            <dt>{s.label}<Computed text={s.hint} /></dt>
            <dd><span class="num">{s.value}</span>{s.unit && <span class="unit"> {s.unit}</span>}</dd>
          </div>
        ))}
      </dl>
      <SettingsCard item={item} />
      {isCombined(item.track) && <CombinedLogs item={item} track={item.track} />}
      {S.items.value.length > 1 && (
        <div class="card-links">
          <button type="button" class="link-btn" title={applyAllHint(item)} onClick={() => S.applyAll(item.id)}>
            <IconCopy /><span>{t('colorHalo.applyAll')}</span>
          </button>
        </div>
      )}
      <div class="card-actions">
        {/* Files whose times have no zone: a reminder that the zone is set there. */}
        <button type="button" class="btn-outline" onClick={() => S.openDetails(item.id)} onMouseEnter={fullTextIfCut(detailsLabel, (el) => el.querySelector('.btn-label'))}>
          <IconDoc /><span class="btn-label">{detailsLabel}</span>
        </button>
        <RemoveButton item={item} />
      </div>
    </div>
  );
}

/**
 * Removes the track on a second click: the first turns the trash icon into a
 * red "Remove?" for 4 seconds. Pressing anywhere else, or waiting, cancels.
 */
function RemoveButton({ item }: { item: TrackItem }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(timer);
  }, [asking]);
  return (
    <button
      type="button" class={`icon-btn outline danger${asking ? ' is-asking' : ''}`}
      aria-label={asking ? undefined : t('details.remove')} title={asking ? t('details.removeAgain') : t('details.remove')}
      onClick={() => { if (asking) S.remove(item.id); else setAsking(true); }} onBlur={() => setAsking(false)}
    >
      <IconTrash />{asking && <span>{t('details.removeAsk')}</span>}
    </button>
  );
}

/** The hover text of "Use on all tracks", naming the measures it copies: "Every track: color by Speed, halo by HDOP". */
export function applyAllHint(item: TrackItem): string {
  const color = item.color === 'none' ? t('colorHalo.allPlain') : t('colorHalo.allColor', { m: measureName(item.color) });
  const halo = item.halo === 'off' ? t('colorHalo.allNoHalo') : t('colorHalo.allHalo', { m: measureName(item.halo) });
  return t('colorHalo.applyAllHint', { color, halo });
}

/**
 * The track's color, halo and timeline settings, shown as one button that
 * opens the settings sheet (pressing it again closes the sheet). The button
 * covers the whole card; the keys' calculator buttons sit on top of it.
 */
function SettingsCard({ item }: { item: TrackItem }) {
  const open = S.picker.value?.id === item.id;
  const relative = item.track.derived.hdopRelative;
  const color = item.color === 'none' ? measureName('none') : measureTitle(item.color, item.color === 'hdop' && relative);
  const halo = item.halo === 'off' ? t('settings.none') : measureTitle(item.halo, item.halo === 'hdop' && relative);
  // The timeline graphs the color measure (speed for a one-color line), and the halo measure too when asked.
  const first = measureName(item.color === 'none' ? 'speed' : item.color);
  const timeline = S.showHaloGraph.value && item.halo !== 'off' ? t('settings.both', { a: first, b: measureName(item.halo) }) : first;
  const id = `sc-${item.id}`;
  return (
    <div class={`settings-card${open ? ' is-open' : ''}`}>
      <button
        type="button" class="settings-hit" id={`${id}-btn`} data-picker-trigger aria-haspopup="dialog" aria-expanded={open ? 'true' : 'false'}
        aria-labelledby={`${id}-cc ${id}-c ${id}-hc ${id}-h ${id}-tc ${id}-t ${id}-go`}
        onClick={() => { S.picker.value = open ? null : { id: item.id }; }}
      />
      <div class="settings-row"><span class="settings-cap" id={`${id}-cc`}>{t('colorHalo.color')}</span><span class="settings-val" id={`${id}-c`}>{color}</span></div>
      {item.color !== 'none' && <Legend item={item} />}
      <div class="settings-row"><span class="settings-cap" id={`${id}-hc`}>{t('colorHalo.halo')}</span><span class="settings-val" id={`${id}-h`}>{halo}</span></div>
      {item.halo !== 'off' && <HaloKey item={item} />}
      <div class="settings-row"><span class="settings-cap" id={`${id}-tc`}>{t('settings.timeline')}</span><span class="settings-val" id={`${id}-t`}>{timeline}</span></div>
      <span class="settings-chev" aria-hidden="true"><IconChevronRight size={18} /></span>
      <span class="sr-only" id={`${id}-go`}>{t('settings.change')}</span>
    </div>
  );
}

export function Legend({ item }: { item: TrackItem }) {
  if (item.color === 'none') return null;
  const key = item.color as MeasureKey;
  const scale = S.scaleFor(item.track, key);
  const colors = palette(item.fam, key, S.dark.value, S.single.value);
  const labels = stepLabels(scale);
  const shares = timeShares(item.track, scale);
  const casing = S.dark.value ? CASING.dark : CASING.light;
  const why = measureHint(item, key, scale);
  // The heading above names the measure; the calculator explains the steps and the percentages.
  return (
    <div class="legend">
      <div class="legend-grid" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr)) auto` }}>
        {labels.map((lb, i) => (
          <div key={i} class="legend-step">
            <svg width="100%" height="10" viewBox="0 0 60 10" preserveAspectRatio="none" aria-hidden="true">
              <path d="M5 5H55" stroke={casing} stroke-width="7.4" stroke-linecap="round" />
              <path d="M5 5H55" stroke={colors[Math.min(i, colors.length - 1)]} stroke-width="4.6" stroke-linecap="round" />
            </svg>
            <span class="mono">{lb}</span>
            <span class="mono muted">{fmtPercent(shares[i] ?? 0, S.locale.value)}</span>
          </div>
        ))}
        <span class="legend-why"><Computed text={why ? `${why} ${explain.shares()}` : explain.shares()} /></span>
      </div>
    </div>
  );
}

/** Why a measure's values or steps are computed, or null when they come straight from the file with fixed steps. */
export function measureHint(item: TrackItem, key: MeasureKey, scale: Scale): string | null {
  if (key === 'grade') return explain.grade();
  if (key === 'hdop' && scale.relative) return explain.hdopRelative();
  if (key === 'speed') {
    const steps = `${explain.steps()} ${scale.log ? explain.stepsLog(scale) : explain.stepsEven(scale)}`;
    return item.track.derived.speedFromFile ? steps : `${explain.speedDerived()} ${steps}`;
  }
  if (key === 'ele') return explain.steps();
  if (key === 'accel') return `${explain.accel()} ${explain.steps()}`;
  return null;
}

export function HaloKey({ item }: { item: TrackItem }) {
  if (item.halo === 'off') return null;
  const key = item.halo as MeasureKey;
  const scale = S.scaleFor(item.track, key);
  const labels = stepLabels(scale);
  const ex = haloExtra(scale.steps);
  const hs = haloStyle(item.fam, S.dark.value, S.single.value);
  const line = palette(item.fam, 'none', S.dark.value, S.single.value)[0];
  const casing = S.dark.value ? CASING.dark : CASING.light;
  return (
    <div class="halo-key">
      <span class="muted small">{t(`halo.hint.${key}${scale.relative ? 'Relative' : ''}`)}{(() => { const why = measureHint(item, key, scale); return why ? <Computed text={why} /> : null; })()}</span>
      <div class="halo-grid" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
        {labels.map((lb, i) => (
          <div key={i} class="halo-step">
            <svg width="100%" height="30" viewBox="0 0 54 30" aria-hidden="true">
              <path d="M13 15H41" stroke={hs.color} stroke-opacity={Math.min(1, hs.opacity * 1.6)} stroke-width={3.6 + ex[i] * 0.9} stroke-linecap="round" />
              <path d="M13 15H41" stroke={casing} stroke-width="6.2" stroke-linecap="round" />
              <path d="M13 15H41" stroke={line} stroke-width="3.6" stroke-linecap="round" />
            </svg>
            <span class="mono small">{lb}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
