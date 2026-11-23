import { useEffect, useRef, useState } from 'preact/hooks';
import * as S from '../state/store';
import { t } from '../state/store';
import { LOAD_LIMIT, SHOW_LIMIT } from '../state/logic';
import { googleBaseFor, googleViewUrl, streetViewUrl } from '../links/google';
import { fixAt } from '../state/inspect';
import { CASING, GAP } from '../color/palettes';
import { hintHandlers, useHintId } from './Computed';
import { TrackRow } from './TrackRow';
import { Details } from './Details';
import { IconExternal, IconPanelHide, IconPanelShow, IconPlus, IconTrash } from './icons';

export function openFilePicker() {
  document.getElementById('tlp-file-input')?.click();
}

function OnMap() {
  const toggles = [
    { key: 'arrows', sig: S.showArrows, label: t('onmap.arrows'), hint: t('onmap.arrowsHint') },
    { key: 'fixes', sig: S.showFixes, label: t('onmap.fixes'), hint: t('onmap.fixesHint') },
    { key: 'gaps', sig: S.showGaps, label: t('onmap.gaps'), hint: t('onmap.gapsHint') },
  ];
  return (
    <section class="panel-sec" aria-labelledby="onmap-h">
      <h2 class="eyebrow" id="onmap-h">{t('onmap.title')}</h2>
      <div class="chip-row">
        {toggles.map((tg) => {
          const on = tg.sig.value;
          return (
            <button key={tg.key} type="button" class={`toggle-chip${on ? ' is-on' : ''}`} aria-pressed={on ? 'true' : 'false'} title={tg.hint} onClick={() => { tg.sig.value = !on; }}>
              <Glyph kind={tg.key} />
              {tg.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

const CASING_INK = CASING.light;
const LINE_INK = '#675aff';

/** A sample of what each "On the map" switch draws, large enough to read. */
function Glyph({ kind }: { kind: string }) {
  return (
    <svg width="46" height="26" viewBox="0 0 46 26" aria-hidden="true" class="glyph">
      {kind === 'arrows' && (
        <>
          <path d="M3 13H43" stroke={CASING_INK} stroke-width="8" stroke-linecap="round" />
          <path d="M3 13H43" stroke={LINE_INK} stroke-width="5" stroke-linecap="round" />
          <path d="M9 6.5L19.5 13 9 19.5 12 13z" fill="#ffffff" stroke="#0b1016" stroke-width="1.4" stroke-linejoin="round" />
          <path d="M26 6.5L36.5 13 26 19.5 29 13z" fill="#ffffff" stroke="#0b1016" stroke-width="1.4" stroke-linejoin="round" />
        </>
      )}
      {kind === 'fixes' && (
        <>
          <path d="M3 13H43" stroke={CASING_INK} stroke-width="8" stroke-linecap="round" />
          <path d="M3 13H43" stroke={LINE_INK} stroke-width="5" stroke-linecap="round" />
          <circle cx="23" cy="13" r="10" fill="#ffffff" stroke="#4951fe" stroke-width="2.6" />
          <text x="23" y="17.4" text-anchor="middle" font-size="12.5" font-weight="800" fill="#101820" font-family="Overpass Mono, ui-monospace, monospace">9</text>
        </>
      )}
      {kind === 'gaps' && (
        <>
          <path d="M3 13H11M35 13H43" stroke={CASING_INK} stroke-width="8" stroke-linecap="round" />
          <path d="M3 13H11M35 13H43" stroke={LINE_INK} stroke-width="5" stroke-linecap="round" />
          <path d="M17 13H29" stroke={GAP.light} stroke-width="4" stroke-dasharray="0.1 6" stroke-linecap="round" />
        </>
      )}
    </svg>
  );
}

// Google My Maps is where Google shows a track you import (GPX, KML or KMZ).
const MY_MAPS = 'https://mymaps.google.com/';

function GoogleLinks() {
  const v = S.mapView.value;
  const sel = S.selected.value;
  const ct = S.cursorT.value;
  // Street View needs a point: the selected track's fix at the cursor.
  const fix = sel && sel.vis && ct !== null ? fixAt(sel.track, S.trackTime(sel.id, ct)) : null;
  const hid = useHintId();
  const how = t('google.myMapsHow');
  return (
    <section class="panel-sec" aria-labelledby="google-h">
      <h2 class="eyebrow" id="google-h">{t('google.title')}</h2>
      <div class="chip-row">
        <a class="link-chip" href={googleViewUrl(v.lat, v.lon, v.zoom, googleBaseFor(S.basemap.value))} target="_blank" rel="noopener noreferrer" title={t('google.note')}>
          {t('google.view')}<IconExternal />
        </a>
        {fix && (
          <a class="link-chip" href={streetViewUrl(fix.lat, fix.lon, Number.isFinite(fix.course) ? fix.course : undefined)} target="_blank" rel="noopener noreferrer" title={t('google.note')}>
            {t('google.street')}<IconExternal />
          </a>
        )}
        {/* How to bring the track in shows on hover or focus, not in the panel. */}
        <a class="link-chip" href={MY_MAPS} target="_blank" rel="noopener noreferrer" aria-describedby="my-maps-how" {...hintHandlers(hid, how, t('google.myMaps'))}>
          {t('google.myMaps')}<IconExternal />
        </a>
        <span id="my-maps-how" class="sr-only">{how}</span>
      </div>
    </section>
  );
}

function TracksPage() {
  const all = S.items.value;
  const shown = S.visible.value.length;
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <section class="panel-sec" aria-labelledby="tracks-h">
        <div class="sec-head">
          <h2 class="eyebrow" id="tracks-h">{t('tracks.title')}</h2>
          <span class="muted small">{t('tracks.shown', { shown, max: SHOW_LIMIT, n: all.length })}</span>
          <span class="grow" />
          <button type="button" class="icon-btn outline" aria-label={t('tracks.clear')} title={t('tracks.clear')} aria-expanded={confirming ? 'true' : 'false'} onClick={() => setConfirming(!confirming)}>
            <IconTrash />
          </button>
          <button type="button" class="btn-dark small" onClick={openFilePicker} disabled={all.length >= LOAD_LIMIT} title={all.length >= LOAD_LIMIT ? t('tracks.full') : undefined}>
            <IconPlus />{t('tracks.add')}
          </button>
        </div>
        {confirming && (
          <div class="confirm-row" role="group" aria-label={t('tracks.clear')}>
            <span>{t('tracks.clearConfirm', { n: all.length })}</span>
            <span class="grow" />
            <button type="button" class="btn-outline small" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
            <button type="button" class="btn-danger small" onClick={() => { setConfirming(false); S.clearAll(); }}>{t('tracks.clearYes')}</button>
          </div>
        )}
        <ul class="track-list">
          {all.map((it) => <li key={it.id}><TrackRow item={it} /></li>)}
        </ul>
      </section>
      <OnMap />
      <GoogleLinks />
    </>
  );
}

export function Panel() {
  const page = S.page.value;
  const body = useRef<HTMLDivElement>(null);
  // A new page starts at the top, not wherever the last one was scrolled to.
  const pageKey = page.kind === 'details' ? `details:${page.id}` : 'tracks';
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [pageKey]);
  return (
    <aside class="panel" aria-label={t('panel.label')}>
      <header class="panel-head">
        <h1 class="app-title">{t('app.name')}</h1>
        <button type="button" class="icon-btn on-dark" aria-expanded="true" aria-label={t('panel.hide')} title={t('panel.hide')} onClick={() => { S.panelMin.value = true; S.picker.value = null; }}>
          <IconPanelHide />
        </button>
      </header>
      <div class="panel-body" ref={body}>
        {page.kind === 'details' ? <Details id={page.id} /> : <TracksPage />}
      </div>
    </aside>
  );
}

/** The minimized panel: just a button that brings it back. */
export function PanelButton() {
  return (
    <button type="button" class="pane-pill panel-pill" aria-expanded="false" aria-label={t('panel.show')} title={t('panel.show')} onClick={() => { S.panelMin.value = false; }}>
      <IconPanelShow />
    </button>
  );
}
