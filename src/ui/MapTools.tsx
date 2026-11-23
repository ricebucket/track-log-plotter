import { useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import * as S from '../state/store';
import { t } from '../state/store';
import { LANGS, LOCALE, langName } from '../i18n/i18n';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from '../map/basemaps';
import { mapApi } from '../map/bridge';
import { fmtNum } from '../format';
import { useDismiss } from './hooks';
import { scaleBar } from './scaleBar';
import { IconCheck, IconClose, IconCompass, IconFit, IconGear, IconZoomIn, IconZoomOut } from './icons';

function Thumb({ id, size = 64 }: { id: BasemapId; size?: number }) {
  const c = BASEMAPS[id].thumb;
  return (
    <svg width="100%" height={size} viewBox="0 0 96 64" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="96" height="64" fill={c.land} />
      <path d="M0 50C22 42 40 58 62 50S88 40 96 44V64H0Z" fill={c.water} />
      <path d="M40 6l26-4 6 30-30 4z" fill={c.park} />
      <path d="M0 26h96M30 0v64M70 0v64" stroke={c.road} stroke-width="3" />
    </svg>
  );
}

/** Language switch: each language is named in itself. */
export function LangToggle() {
  return (
    <div class="seg" role="group" aria-labelledby="opt-lang-h">
      {LANGS.map((l) => (
        <button key={l} type="button" lang={LOCALE[l]} aria-pressed={S.lang.value === l ? 'true' : 'false'} onClick={() => { S.lang.value = l; }}>
          {langName(l)}
        </button>
      ))}
    </div>
  );
}

/** The Options menu: basemap, language and units. */
function OptionsMenu({ trigger }: { trigger: RefObject<HTMLButtonElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => { S.basemapOpen.value = false; }, trigger);
  return (
    <div class="popover options-menu" role="dialog" aria-labelledby="opt-h" ref={ref}>
      <div class="picker-head">
        <h2 id="opt-h">{t('options.title')}</h2>
        <button type="button" class="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={() => { S.basemapOpen.value = false; }}><IconClose /></button>
      </div>
      <section class="opt-sec" aria-labelledby="bm-h">
      <h3 class="eyebrow" id="bm-h">{t('basemap.title')}</h3>
      <div class="bm-grid">
        {BASEMAP_IDS.map((id) => {
          const on = S.basemap.value === id;
          return (
            <button key={id} type="button" class={`bm-tile${on ? ' is-on' : ''}`} aria-pressed={on ? 'true' : 'false'} onClick={() => { S.basemap.value = id; }}>
              <span class="bm-thumb"><Thumb id={id} />{on && <span class="bm-check"><IconCheck /></span>}</span>
              <span class="bm-name">{t(`basemap.${id}`)}</span>
              <span class="bm-provider">{BASEMAPS[id].provider}</span>
            </button>
          );
        })}
      </div>
      <span class="muted small">{t('basemap.labelsNote')}</span>
      <div class="fade">
        <div class="fade-head"><label for="tlp-dim">{t('basemap.fade')}</label><span class="mono muted small">{Math.round(S.dim.value * 100)}%</span></div>
        <input id="tlp-dim" type="range" min="0" max="70" step="5" value={Math.round(S.dim.value * 100)} onInput={(e) => { S.dim.value = Number((e.currentTarget as HTMLInputElement).value) / 100; }} />
        <span class="muted small">{t('basemap.fadeHint')}</span>
      </div>
      </section>
      <section class="opt-sec" aria-labelledby="opt-lang-h">
        <h3 class="eyebrow" id="opt-lang-h">{t('lang.label')}</h3>
        <LangToggle />
      </section>
      <section class="opt-sec" aria-labelledby="opt-units-h">
        <h3 class="eyebrow" id="opt-units-h">{t('settings.units')}</h3>
        <div role="radiogroup" aria-labelledby="opt-units-h" class="radio-list">
          {(['metric', 'imperial'] as const).map((u) => (
            <button key={u} type="button" role="radio" aria-checked={S.units.value === u ? 'true' : 'false'} onClick={() => { S.units.value = u; }}>
              <span class="radio-dot" aria-hidden="true" />
              <span>{t(`settings.${u}`)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function MapTools() {
  const id = S.basemap.value;
  const btn = useRef<HTMLButtonElement>(null);
  // The compass shows only once the map is turned or tilted (right-drag or a
  // two-finger twist). Its needle points north; pressing it turns the map back.
  const v = S.mapView.value;
  const turned = Math.abs(v.bearing) > 0.5 || v.pitch > 0.5;
  return (
    <div class="map-tools">
      {/* One button for every option: it keeps showing the basemap, and the gear says it holds more. */}
      <button ref={btn} type="button" class="bm-button" aria-haspopup="dialog" aria-expanded={S.basemapOpen.value ? 'true' : 'false'} title={t('options.hint')} onClick={() => { S.basemapOpen.value = !S.basemapOpen.value; }}>
        <span class="bm-mini"><Thumb id={id} size={40} /></span>
        <span class="bm-button-text"><span class="eyebrow">{t('basemap.title')}</span><span class="bm-current">{t(`basemap.${id}`)}</span></span>
        <span class="bm-opts"><IconGear size={21} /><span class="sr-only">{t('options.title')}</span></span>
      </button>
      <div class="zoom-stack">
        <button type="button" class="zoom-btn" aria-label={t('map.zoomIn')} title={t('map.zoomIn')} onClick={() => mapApi.zoomIn()}><IconZoomIn /></button>
        <button type="button" class="zoom-btn" aria-label={t('map.zoomOut')} title={t('map.zoomOut')} onClick={() => mapApi.zoomOut()}><IconZoomOut /></button>
        <button type="button" aria-label={t('map.fit')} title={t('map.fit')} onClick={() => mapApi.fit()}><IconFit /></button>
        {turned && (
          <button type="button" class="compass" aria-label={t('map.north')} title={t('map.north')} onClick={() => mapApi.north()}>
            <span style={{ transform: `rotate(${-v.bearing}deg)` }}><IconCompass /></span>
          </button>
        )}
      </div>
      {S.basemapOpen.value && <OptionsMenu trigger={btn} />}
    </div>
  );
}

export function MapFooter() {
  const v = S.mapView.value;
  const sb = scaleBar(v.lat, v.zoom, S.units.value === 'imperial');
  const ink = S.dark.value ? '#ffffff' : '#101820';
  return (
    <div class="map-footer">
      <div class="scale" style={{ color: ink }} aria-hidden="true">
        <span class="mono small">{fmtNum(sb.value, S.locale.value, 1, 0)} {t(`unit.${sb.unit}`)}</span>
        <span class="scale-bar" style={{ width: `${Math.round(sb.px)}px`, borderColor: ink }} />
      </div>
      {/* Provider attribution strings are fixed in basemaps.ts and contain only links. */}
      <div class={`attribution${S.dark.value ? ' on-dark' : ''}`} dangerouslySetInnerHTML={{ __html: BASEMAPS[S.basemap.value].attribution }} />
    </div>
  );
}
