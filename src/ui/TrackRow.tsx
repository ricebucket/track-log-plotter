import type { MeasureKey } from '../model/types';
import type { TrackItem } from '../state/logic';
import * as S from '../state/store';
import { t } from '../state/store';
import { palette, haloExtra, haloStyle, CASING, FAMILIES, HIDDEN_BADGE } from '../color/palettes';
import { timeShares, type Scale } from '../color/scale';
import { fmtDistance, fmtDuration, fmtPercent, fmtSpeed } from '../format';
import { differentDays, fmtShortDate } from '../time/zones';
import { measureName, measureTitle, stepLabels, unitOf } from './labels';
import { IconChevronRight, IconCopy, IconDoc, IconEye, IconEyeOff, IconWarn } from './icons';
import { Computed } from './Computed';
import { explain } from './computedText';

export function badgeOf(it: TrackItem): string {
  return it.vis ? FAMILIES[it.fam % 3].badge : HIDDEN_BADGE;
}

export function TrackRow({ item }: { item: TrackItem }) {
  const sel = S.selected.value?.id === item.id;
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
    tr.format.toUpperCase(),
  ].join(' · ');

  return (
    <div class={`track-row${sel ? ' is-selected' : ''}${item.vis ? '' : ' is-hidden'}`} data-track={item.id}>
      <div class="track-row-head">
        <button
          type="button" class="icon-btn eye" aria-pressed={item.vis ? 'true' : 'false'}
          aria-label={item.vis ? t('track.hide', { id: item.id }) : t('track.show', { id: item.id })}
          title={item.vis ? t('track.hide', { id: item.id }) : t('track.show', { id: item.id })}
          onClick={() => S.toggleVisible(item.id)}
        >
          {item.vis ? <IconEye /> : <IconEyeOff />}
        </button>
        <button type="button" class="track-main" aria-expanded={sel ? 'true' : 'false'} onClick={() => S.select(item.id)}>
          <span class="badge" style={{ background: badgeOf(item) }}>{item.id}</span>
          <span class="track-text">
            <span class="track-name">{tr.file}</span>
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
      {sel && <TrackDetailsInline item={item} />}
    </div>
  );
}

function TrackDetailsInline({ item }: { item: TrackItem }) {
  const st = item.track.derived.stats;
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
      <div class="color-halo" role="group" aria-label={t('colorHalo.label')}>
        <MeasureRow item={item} which="color" />
        {item.color !== 'none' && <Legend item={item} />}
        <MeasureRow item={item} which="halo" />
        {item.halo !== 'off' && <HaloKey item={item} />}
        {S.items.value.length > 1 && (
          <button type="button" class="link-btn" title={applyAllHint(item)} onClick={() => S.applyAll(item.id)}>
            <IconCopy /><span>{t('colorHalo.applyAll')}</span>
          </button>
        )}
      </div>
      <button type="button" class="btn-outline" onClick={() => S.openDetails(item.id)}>
        <IconDoc />{t('track.details')}
      </button>
    </div>
  );
}

/** The hover text of "Use on all tracks", naming the measures it copies: "Every track: color by Speed, halo by HDOP". */
export function applyAllHint(item: TrackItem): string {
  const color = item.color === 'none' ? t('colorHalo.allPlain') : t('colorHalo.allColor', { m: measureName(item.color) });
  const halo = item.halo === 'off' ? t('colorHalo.allNoHalo') : t('colorHalo.allHalo', { m: measureName(item.halo) });
  return t('colorHalo.applyAllHint', { color, halo });
}

/**
 * The heading of the color or the halo section. It opens the measure pane
 * beside the panel, so it reads as a heading with a "go to" arrow rather than
 * a drop-down list; pressing it again closes the pane.
 */
function MeasureRow({ item, which }: { item: TrackItem; which: 'color' | 'halo' }) {
  const key = which === 'color' ? item.color : item.halo;
  const open = S.picker.value?.which === which;
  const relative = key === 'hdop' && item.track.derived.hdopRelative;
  const value = key === 'none' || key === 'off' ? measureName(key) : measureTitle(key, relative);
  return (
    <button
      type="button" class={`measure-btn${open ? ' is-open' : ''}`} data-picker-trigger
      aria-haspopup="dialog" aria-expanded={open ? 'true' : 'false'}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        S.picker.value = open ? null : { which, anchorTop: r.top };
      }}
    >
      <span class="measure-label">{which === 'color' ? t('colorHalo.color') : t('colorHalo.halo')}</span>
      <span class="measure-value">{value}</span>
      <IconChevronRight />
    </button>
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
    const steps = scale.log ? `${explain.steps()} ${explain.stepsLog(scale)}` : explain.steps();
    return item.track.derived.speedFromFile ? steps : `${explain.speedDerived()} ${steps}`;
  }
  if (key === 'ele') return explain.steps();
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
