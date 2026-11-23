import { useEffect, useRef } from 'preact/hooks';
import type { ColorKey, HaloKey, MeasureKey } from '../model/types';
import * as S from '../state/store';
import { t } from '../state/store';
import { measuresOf } from '../state/logic';
import { measureName } from './labels';
import { useDismiss } from './hooks';
import { IconCalc, IconClose } from './icons';

const COLOR_KEYS: ColorKey[] = ['speed', 'ele', 'grade', 'hdop', 'sats', 'fix', 'none'];
const HALO_KEYS: HaloKey[] = ['speed', 'ele', 'grade', 'hdop', 'sats', 'fix', 'off'];

/** A pane beside the panel listing every measure with a full explanation. */
export function MeasurePicker() {
  const p = S.picker.value;
  const item = S.selected.value;
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { S.picker.value = null; };
  useDismiss(ref, close, '[data-picker-trigger]');
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [p?.which]);
  if (!p || !item) return null;

  const which = p.which;
  const keys = which === 'color' ? COLOR_KEYS : HALO_KEYS;
  const avail = measuresOf(item.track);
  const current = which === 'color' ? item.color : item.halo;
  const relative = item.track.derived.hdopRelative;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
  const top = Math.max(16, Math.min(p.anchorTop - 24, vh - 640));

  const pick = (k: ColorKey | HaloKey) => {
    S.setMeasure(item.id, which, k);
    close();
  };

  return (
    <div class="picker" role="dialog" aria-labelledby="picker-title" ref={ref} style={{ top: `${top}px`, maxHeight: `${vh - top - 16}px` }}>
      <div class="picker-head">
        <h2 id="picker-title">{which === 'color' ? t('picker.colorTitle', { id: item.id }) : t('picker.haloTitle', { id: item.id })}</h2>
        <button type="button" class="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={close}><IconClose /></button>
      </div>
      <p class="picker-intro">{which === 'color' ? t('picker.colorIntro') : t('picker.haloIntro')}</p>
      <div class="picker-list" role="radiogroup" aria-labelledby="picker-title">
        {keys.map((k) => {
          const ok = k === 'none' || k === 'off' || avail.has(k as MeasureKey);
          const on = k === current;
          return (
            <button
              key={k} type="button" role="radio" class={`picker-opt${on ? ' is-on' : ''}`}
              aria-checked={on ? 'true' : 'false'} aria-disabled={ok ? 'false' : 'true'} disabled={!ok}
              onClick={() => pick(k)}
            >
              <span class="radio-dot" aria-hidden="true" />
              <span class="opt-text">
                <span class="opt-title">
                  <span class="opt-name">{measureName(k)}</span>
                  {(k === 'grade' || (k === 'speed' && !item.track.derived.speedFromFile)) && <span class="computed-tag"><IconCalc size={11} />{t('computed.tag')}</span>}
                </span>
                <span class="opt-desc">{t(`measure.${k}.long`)}</span>
                {k === 'hdop' && relative && ok && <span class="opt-note">{t('measure.hdop.relativeNote')}</span>}
                {!ok && <span class="opt-na">{t('picker.notInFile')}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
