import * as S from '../state/store';
import { t } from '../state/store';
import { NARROW, useMedia } from './hooks';
import { IconChevronDown, IconPanelHide } from './icons';

/**
 * Minimizes the panel. It sits in the panel's title bar; a phone has no title bar (its room goes to the list), so
 * there it sits at the right end of the page's top row, as a down arrow like the timeline's.
 */
export function PanelHide({ onDark = false }: { onDark?: boolean }) {
  const sheet = useMedia(NARROW);
  return (
    <button
      type="button" class={`icon-btn ${onDark ? 'on-dark' : 'outline'}`} aria-expanded="true" aria-label={t('panel.hide')} title={t('panel.hide')}
      onClick={() => { S.panelMin.value = true; S.picker.value = null; }}
    >
      {sheet ? <IconChevronDown size={18} /> : <IconPanelHide />}
    </button>
  );
}

/** Minimize at the end of a page's top row, on a phone only (elsewhere it is in the title bar). */
export function PanelHideOnPhone() {
  return useMedia(NARROW) ? <PanelHide /> : null;
}
