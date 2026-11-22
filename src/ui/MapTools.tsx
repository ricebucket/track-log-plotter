import { useRef } from 'preact/hooks';
import * as S from '../state/store';
import { t } from '../state/store';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from '../map/basemaps';
import { mapApi } from '../map/bridge';
import { fmtNum } from '../format';
import { useDismiss } from './hooks';
import { scaleBar } from './scaleBar';
import { IconCheck, IconChevronDown, IconClose, IconFit, IconNorth, IconZoomIn, IconZoomOut } from './icons';

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

function BasemapMenu() {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => { S.basemapOpen.value = false; });
  return (
    <div class="popover basemap-menu" role="dialog" aria-labelledby="bm-h" ref={ref}>
      <div class="picker-head">
        <h2 id="bm-h">{t('basemap.title')}</h2>
        <button type="button" class="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={() => { S.basemapOpen.value = false; }}><IconClose /></button>
      </div>
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
    </div>
  );
}

export function MapTools() {
  const id = S.basemap.value;
  return (
    <div class="map-tools">
      <button type="button" class="bm-button" aria-haspopup="dialog" aria-expanded={S.basemapOpen.value ? 'true' : 'false'} onClick={() => { S.basemapOpen.value = !S.basemapOpen.value; }}>
        <span class="bm-mini"><Thumb id={id} size={40} /></span>
        <span class="bm-button-text"><span class="eyebrow">{t('basemap.title')}</span><span class="bm-current">{t(`basemap.${id}`)}</span></span>
        <IconChevronDown size={16} />
      </button>
      <div class="zoom-stack">
        <button type="button" class="zoom-btn" aria-label={t('map.zoomIn')} title={t('map.zoomIn')} onClick={() => mapApi.zoomIn()}><IconZoomIn /></button>
        <button type="button" class="zoom-btn" aria-label={t('map.zoomOut')} title={t('map.zoomOut')} onClick={() => mapApi.zoomOut()}><IconZoomOut /></button>
        <button type="button" aria-label={t('map.fit')} title={t('map.fit')} onClick={() => mapApi.fit()}><IconFit /></button>
        <button type="button" aria-label={t('map.north')} title={t('map.north')} onClick={() => mapApi.north()}><IconNorth /></button>
      </div>
      {S.basemapOpen.value && <BasemapMenu />}
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
