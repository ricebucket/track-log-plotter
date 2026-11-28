import { useEffect, useRef, useState } from 'preact/hooks';
import * as S from '../state/store';
import { t } from '../state/store';
import { LOAD_LIMIT, SHOW_LIMIT } from '../state/logic';
import { googleBaseFor, googleViewUrl, streetViewUrl } from '../links/google';
import { fixAt } from '../state/inspect';
import { CASING, GAP } from '../color/palettes';
import { hint, hintHandlers, useHintId } from './Computed';
import { TrackRow } from './TrackRow';
import { Details } from './Details';
import { IconCheck, IconChevronDown, IconCombine, IconExternal, IconEye, IconEyeOff, IconLayers, IconMap, IconPanelShow, IconPegman, IconPlus, IconSelect, IconSheetShow, IconTrash } from './icons';
import { PanelHide, PanelHideOnPhone } from './PanelHide';
import { focusAfterRender, NARROW, openButton, rowButton, useDismiss, useFocusAfterRender, useMedia } from './hooks';

export function openFilePicker() {
  document.getElementById('tlp-file-input')?.click();
}

/** The "On the map" switches: icons beside the label, named on hover or focus. */
function OnMap() {
  const ids = [useHintId(), useHintId(), useHintId()];
  const toggles = [
    { key: 'arrows', sig: S.showArrows, label: t('onmap.arrows'), hint: t('onmap.arrowsHint') },
    { key: 'fixes', sig: S.showFixes, label: t('onmap.fixes'), hint: t('onmap.fixesHint') },
    { key: 'gaps', sig: S.showGaps, label: t('onmap.gaps'), hint: t('onmap.gapsHint') },
  ];
  return (
    <section class="panel-sec" aria-labelledby="onmap-h">
      <div class="sec-head">
        <h2 class="eyebrow" id="onmap-h">{t('onmap.title')}</h2>
        <span class="grow" />
        {toggles.map((tg, k) => {
          const on = tg.sig.value;
          return (
            <button
              key={tg.key} type="button" class={`toggle-chip icon-only${on ? ' is-on' : ''}`} aria-pressed={on ? 'true' : 'false'}
              aria-label={tg.label} aria-describedby={`onmap-${tg.key}`} {...hintHandlers(ids[k], tg.hint, tg.label)}
              onClick={() => { tg.sig.value = !on; }}
            >
              <Glyph kind={tg.key} />
            </button>
          );
        })}
        {toggles.map((tg) => <span key={tg.key} id={`onmap-${tg.key}`} class="sr-only">{tg.hint}</span>)}
      </div>
    </section>
  );
}

const CASING_INK = CASING.light;
const LINE_INK = '#675aff';

/** A sample of what each "On the map" switch draws, large enough to read. */
function Glyph({ kind }: { kind: string }) {
  // Compact: a short piece of line with one arrow or one fix, or a few gap dots.
  return (
    <svg width="30" height="24" viewBox="0 0 30 24" aria-hidden="true" class="glyph">
      {kind !== 'gaps' && <path d="M3 12H27" stroke={CASING_INK} stroke-width="8" stroke-linecap="round" />}
      {kind !== 'gaps' && <path d="M3 12H27" stroke={LINE_INK} stroke-width="5" stroke-linecap="round" />}
      {kind === 'arrows' && <path d="M9.5 5.5L20.5 12 9.5 18.5 12.5 12z" fill="#ffffff" stroke="#0b1016" stroke-width="1.4" stroke-linejoin="round" />}
      {kind === 'fixes' && (
        <>
          <circle cx="15" cy="12" r="9.5" fill="#ffffff" stroke="#4951fe" stroke-width="2.6" />
          {/* The satellite count "9", drawn as a shape: as text it would count as the button's visible label. */}
          <path d="M16.6 10.7a2.1 2.1 0 1 1 0-.01M16.6 10.6v2.2c0 1.6-1 2.6-2.6 2.8" fill="none" stroke="#101820" stroke-width="1.7" stroke-linecap="round" />
        </>
      )}
      {kind === 'gaps' && <path d="M4.5 12H26" stroke={GAP.light} stroke-width="4.6" stroke-dasharray="0.1 7" stroke-linecap="round" />}
    </svg>
  );
}

// Google My Maps is where Google shows a track you import (GPX, KML or KMZ).
const MY_MAPS = 'https://mymaps.google.com/';

/** One "Open in Google Maps" button; its menu lists the links with their full names. */
function GoogleLinks() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <section class="panel-sec" aria-labelledby="google-h">
      <div class="sec-head">
        <h2 class="eyebrow" id="google-h">{t('google.title')}</h2>
        <span class="grow" />
        <button
          ref={trigger} type="button" class={`icon-btn outline google-btn${open ? ' is-open' : ''}`} aria-expanded={open ? 'true' : 'false'}
          aria-controls="google-menu" aria-label={t('google.open')} title={t('google.open')} onClick={() => setOpen(!open)}
        >
          <IconMap /><IconChevronDown size={12} />
        </button>
      </div>
      {open && <GoogleMenu trigger={trigger} close={() => setOpen(false)} />}
    </section>
  );
}

function GoogleMenu({ trigger, close }: { trigger: { current: HTMLButtonElement | null }; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, close, trigger);
  const hid = useHintId();
  // The My Maps how-to may be showing when the menu closes under the pointer.
  useEffect(() => () => { if (hint.value?.id === hid) hint.value = null; }, [hid]);
  // When the menu closes with the focus inside (Escape, a link followed), the focus goes back to its button. Not on
  // the Escape that only closes the My Maps how-to over it.
  useEffect(() => {
    const el = ref.current;
    return () => {
      const at = document.activeElement;
      if (!at || at === document.body || el?.contains(at)) trigger.current?.focus();
    };
  }, [trigger]);
  const v = S.mapView.value;
  const sel = S.selected.value;
  const ct = S.cursorT.value;
  // Street View needs a point: the selected track's fix at the cursor.
  const fix = sel && sel.vis && ct !== null ? fixAt(sel.track, S.trackTime(sel.id, ct)) : null;
  const how = t('google.myMapsHow');
  return (
    <div class="google-menu" id="google-menu" ref={ref}>
      <a class="menu-item" href={googleViewUrl(v.lat, v.lon, v.zoom, googleBaseFor(S.basemap.value))} target="_blank" rel="noopener noreferrer" title={t('google.note')} onClick={close}>
        <IconMap size={16} /><span>{t('google.view')}</span><IconExternal />
      </a>
      {fix && (
        <a class="menu-item" href={streetViewUrl(fix.lat, fix.lon, Number.isFinite(fix.course) ? fix.course : undefined)} target="_blank" rel="noopener noreferrer" title={t('google.note')} onClick={close}>
          <IconPegman size={16} /><span>{t('google.street')}</span><IconExternal />
        </a>
      )}
      {/* The full how-to shows on hover or focus; the menu keeps a short line. */}
      <a class="menu-item" href={MY_MAPS} target="_blank" rel="noopener noreferrer" aria-describedby="my-maps-how" {...hintHandlers(hid, how, t('google.myMaps'))} onClick={close}>
        <IconLayers size={16} /><span>{t('google.myMaps')}<small>{t('google.myMapsShort')}</small></span><IconExternal />
      </a>
      <span id="my-maps-how" class="sr-only">{how}</span>
    </div>
  );
}

/** Whether a menu, list or sheet is open over the page: Escape closes that first. */
const popoverOpen = () => !!(S.picker.peek() || S.zoneOpen.peek() || S.basemapOpen.peek() || S.clockPicker.peek());

function TracksPage() {
  const all = S.items.value;
  const shown = S.visible.value.length;
  const selecting = S.selecting.value;
  const ticked = S.ticked.value;
  useFocusAfterRender();
  // Escape ends select mode. A menu, list or sheet open on top closes first and keeps the key: its
  // Escape is marked as used when it saw it first, and it is still open when this sees it first.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !popoverOpen()) S.endSelect(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selecting]);
  const allTicked = all.length > 0 && ticked.length === all.length;
  const someTicked = !allTicked && ticked.length > 0;
  return (
    <>
      <section class={`panel-sec${selecting ? ' is-selecting' : ''}`} aria-labelledby="tracks-h">
        <div class="sec-head">
          <h2 class="eyebrow" id="tracks-h">{t('tracks.title')}</h2>
          {selecting ? (
            <>
              <span class="grow" />
              <button type="button" class="select-all" role="checkbox" aria-checked={allTicked ? 'true' : someTicked ? 'mixed' : 'false'} onClick={() => S.tickAll()}>
                <span class={`tick-box${allTicked ? ' is-on' : someTicked ? ' is-mixed' : ''}`} aria-hidden="true">{allTicked && <IconCheck size={13} />}</span>{t('select.all')}
              </button>
              <button type="button" class="btn-dark small" onClick={() => S.endSelect()}>{t('select.done')}</button>
              <PanelHideOnPhone />
            </>
          ) : (
            <>
              <span class="muted small">{t('tracks.shown', { shown, max: SHOW_LIMIT, n: all.length })}</span>
              <span class="grow" />
              <button
                type="button" class="icon-btn outline" aria-label={shown ? t('tracks.hideAll') : t('tracks.showAll')} title={shown ? t('tracks.hideAll') : t('tracks.showAll')}
                onClick={() => S.toggleAllVisible()}
              >
                {shown ? <IconEye size={17} /> : <IconEyeOff size={17} />}
              </button>
              <button type="button" id="tlp-select" class="icon-btn outline" aria-label={t('tracks.select')} title={t('tracks.selectHint')} onClick={() => S.startSelect()}>
                <IconSelect size={17} />
              </button>
              <button type="button" id="tlp-add" class="btn-dark small" onClick={openFilePicker} disabled={all.length >= LOAD_LIMIT} title={all.length >= LOAD_LIMIT ? t('tracks.full') : undefined}>
                <IconPlus />{t('tracks.add')}
              </button>
              <PanelHideOnPhone />
            </>
          )}
        </div>
        <ul class="track-list">
          {/* Each row redraws only when its own track changes (TrackRow is memoized), not for every change to the list. */}
          {all.map((it) => <li key={it.id}><TrackRow item={it} /></li>)}
        </ul>
        {selecting && <SelectBar />}
      </section>
      {!selecting && <OnMap />}
      {!selecting && <GoogleLinks />}
    </>
  );
}

/** Why Combine can't be pressed, for each reason the instant checks give. */
const WHY: Record<'few' | 'many' | 'combined' | 'noOverlap', () => string> = {
  few: () => t('combine.why.few'),
  many: () => t('combine.why.many'),
  combined: () => t('combine.why.combined'),
  noOverlap: () => t('combine.why.noOverlap'),
};

/**
 * The bar under the list in select mode: Combine and Remove at its two ends,
 * so neither is pressed by mistake, and the count between them. Remove asks
 * once more ("Remove 3?"), like the trash button on a track.
 */
function SelectBar() {
  const ids = S.ticked.value;
  const why = S.combineBlock(ids);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(timer);
  }, [asking]);
  // A different selection is a different question.
  useEffect(() => setAsking(false), [ids.length]);
  return (
    <div class="select-bar-wrap">
      <div class="select-bar" role="toolbar" aria-label={t('select.bar')}>
        <button
          type="button" class="bar-btn" aria-disabled={why ? 'true' : undefined} aria-describedby={why ? 'combine-why' : undefined}
          onClick={() => {
            if (why) return;
            // The bar goes with select mode: the keyboard moves on to the new track's row.
            const id = S.combineTicked();
            if (id) focusAfterRender(() => rowButton(id));
          }}
        >
          <IconCombine />{t('select.combine')}
        </button>
        <span class="bar-count" aria-live="polite">{t('select.count', { n: ids.length })}</span>
        <button
          type="button" class={`bar-btn remove${asking ? ' is-asking' : ''}`} aria-disabled={ids.length ? undefined : 'true'}
          title={asking ? t('select.removeAgain') : undefined}
          onClick={() => {
            if (!ids.length) return;
            if (!asking) { setAsking(true); return; }
            // The bar goes with select mode: the keyboard goes to the Select button that brings it back.
            focusAfterRender(() => document.getElementById('tlp-select') ?? openButton());
            S.removeTicked();
          }}
          onBlur={() => setAsking(false)}
        >
          <IconTrash />{asking ? t('select.removeAsk', { n: ids.length }) : t('select.remove')}
        </button>
      </div>
      {why && <p class="select-why" id="combine-why">{WHY[why]()}</p>}
    </div>
  );
}

export function Panel() {
  // On phones the panel is a bottom sheet with no title bar: the room goes to the list (Minimize is in each page's top row).
  const sheet = useMedia(NARROW);
  const page = S.page.value;
  const body = useRef<HTMLDivElement>(null);
  // A new page starts at the top, not wherever the last one was scrolled to.
  const pageKey = page.kind === 'details' ? `details:${page.id}` : 'tracks';
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [pageKey]);
  return (
    <aside class="panel" aria-label={t('panel.label')}>
      {sheet ? <h1 class="sr-only">{t('app.name')}</h1> : (
        <header class="panel-head">
          <h1 class="app-title">{t('app.name')}</h1>
          <PanelHide onDark />
        </header>
      )}
      <div class="panel-body" ref={body}>
        {page.kind === 'details' ? <Details id={page.id} /> : <TracksPage />}
      </div>
    </aside>
  );
}

/** The minimized panel: just a button that brings it back. */
export function PanelButton() {
  const sheet = useMedia(NARROW);
  return (
    <button type="button" class="pane-pill panel-pill" aria-expanded="false" aria-label={t('panel.show')} title={t('panel.show')} onClick={() => { S.panelMin.value = false; }}>
      {sheet ? <IconSheetShow /> : <IconPanelShow />}
    </button>
  );
}
