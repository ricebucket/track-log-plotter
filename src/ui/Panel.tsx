import { useEffect, useRef } from 'preact/hooks';
import * as S from '../state/store';
import { t } from '../state/store';
import { LANGS } from '../i18n/i18n';
import { LOAD_LIMIT, SHOW_LIMIT } from '../state/logic';
import { googleBaseFor, googleViewUrl, streetViewUrl } from '../links/google';
import { fixAt } from '../state/inspect';
import { TrackRow } from './TrackRow';
import { Details } from './Details';
import { useDismiss } from './hooks';
import { IconExternal, IconPanelHide, IconPanelShow, IconPlus, IconSettings, IconCheck } from './icons';

export function openFilePicker() {
  document.getElementById('tlp-file-input')?.click();
}

export function LangToggle({ onDark = false }: { onDark?: boolean }) {
  return (
    <div class={`seg${onDark ? ' on-dark' : ''}`} role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l === 'zh' ? 'zh-CN' : 'en-US'} aria-pressed={S.lang.value === l ? 'true' : 'false'} onClick={() => { S.lang.value = l; }}>
          {l === 'zh' ? '中文' : 'EN'}
        </button>
      ))}
    </div>
  );
}

function Settings() {
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const open = S.settingsOpen.value;
  useDismiss(ref, () => { S.settingsOpen.value = false; }, btn);
  return (
    <>
      <button ref={btn} type="button" class="icon-btn on-dark" aria-haspopup="dialog" aria-expanded={open ? 'true' : 'false'} aria-label={t('settings.label')} title={t('settings.label')} onClick={() => { S.settingsOpen.value = !open; }}>
        <IconSettings />
      </button>
      {open && (
        <div class="popover settings" role="dialog" aria-label={t('settings.label')} ref={ref}>
          <span class="eyebrow">{t('settings.units')}</span>
          <div role="radiogroup" aria-label={t('settings.units')} class="radio-list">
            {(['metric', 'imperial'] as const).map((u) => (
              <button key={u} type="button" role="radio" aria-checked={S.units.value === u ? 'true' : 'false'} onClick={() => { S.units.value = u; }}>
                <span class="radio-dot" aria-hidden="true" />
                <span>{t(`settings.${u}`)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
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
              <span class="check" aria-hidden="true">{on && <IconCheck />}</span>
              <Glyph kind={tg.key} />
              {tg.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** A small sample of what each "On the map" switch draws. */
function Glyph({ kind }: { kind: string }) {
  return (
    <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true" class="glyph">
      {kind !== 'gaps' && <path d="M2 13C9 13 10 5 17 5s9 4 11 4" fill="none" stroke="rgba(10,16,22,0.55)" stroke-width="5.6" stroke-linecap="round" />}
      {kind !== 'gaps' && <path d="M2 13C9 13 10 5 17 5s9 4 11 4" fill="none" stroke="#5168ff" stroke-width="3.4" stroke-linecap="round" />}
      {kind === 'arrows' && <path d="M12.5 5.6l5 2.9-5 2.9 1.4-2.9z" fill="#ffffff" stroke="#0b1016" stroke-width="0.9" stroke-linejoin="round" />}
      {kind === 'fixes' && <><circle cx="15" cy="9" r="6.2" fill="#ffffff" stroke="#4951fe" stroke-width="2.2" /><text x="15" y="11.9" text-anchor="middle" font-size="8" font-weight="700" fill="#101820" font-family="Overpass Mono, monospace">9</text></>}
      {kind === 'gaps' && <><path d="M2 9h6M22 9h6" stroke="#5168ff" stroke-width="3.4" stroke-linecap="round" /><path d="M10 9h10" stroke="#47525d" stroke-width="2.4" stroke-dasharray="0.5 3.2" stroke-linecap="round" /></>}
    </svg>
  );
}

function GoogleLinks() {
  const v = S.mapView.value;
  const sel = S.selected.value;
  const ct = S.cursorT.value;
  const fix = sel && ct !== null ? fixAt(sel.track, S.trackTime(sel.id, ct)) : null;
  const street = fix ? streetViewUrl(fix.lat, fix.lon, Number.isFinite(fix.course) ? fix.course : undefined) : streetViewUrl(v.lat, v.lon);
  return (
    <section class="panel-sec" aria-labelledby="google-h">
      <h2 class="eyebrow" id="google-h">{t('google.title')}</h2>
      <div class="chip-row">
        <a class="link-chip" href={googleViewUrl(v.lat, v.lon, v.zoom, googleBaseFor(S.basemap.value))} target="_blank" rel="noopener noreferrer" title={t('google.note')}>
          {t('google.view')}<IconExternal />
        </a>
        <a class="link-chip" href={street} target="_blank" rel="noopener noreferrer" title={t('google.note')}>
          {fix ? t('google.streetCursor') : t('google.streetCenter')}<IconExternal />
        </a>
      </div>
    </section>
  );
}

function TracksPage() {
  const all = S.items.value;
  const shown = S.visible.value.length;
  return (
    <>
      <section class="panel-sec" aria-labelledby="tracks-h">
        <div class="sec-head">
          <h2 class="eyebrow" id="tracks-h">{t('tracks.title')}</h2>
          <span class="muted small">{t('tracks.shown', { shown, max: SHOW_LIMIT, n: all.length })}</span>
          <span class="grow" />
          <button type="button" class="btn-dark small" onClick={openFilePicker} disabled={all.length >= LOAD_LIMIT} title={all.length >= LOAD_LIMIT ? t('tracks.full') : undefined}>
            <IconPlus />{t('tracks.add')}
          </button>
        </div>
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
        <LangToggle onDark />
        <Settings />
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
