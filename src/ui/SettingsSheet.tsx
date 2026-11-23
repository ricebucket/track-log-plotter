import { useEffect, useRef } from 'preact/hooks';
import { MEASURES, type MeasureKey } from '../model/types';
import * as S from '../state/store';
import { t } from '../state/store';
import { measuresOf } from '../state/logic';
import { measureName, measureTitle } from './labels';
import { Badge } from './Badge';
import { useDismiss } from './hooks';
import { IconCalc, IconClose, IconSwap } from './icons';

/**
 * A track's color, halo and timeline settings, opened from its card: a sheet
 * beside the panel (over the panel in a narrow window, a bottom sheet on a
 * phone). Each measure the file has gets a row with its full description and
 * one radio button in the Color column and one in the Halo column; "None"
 * gives a one-color line or no halo. Measures the file doesn't have are left
 * out. Choices apply at once, so the map changes as you click.
 */
export function SettingsSheet() {
  const p = S.picker.value;
  const item = p ? S.items.value.find((x) => x.id === p.id) : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { S.picker.value = null; };
  useDismiss(ref, close, '[data-picker-trigger]');
  // Start on the measure that colors the track, so the arrow keys move from there.
  useEffect(() => { ref.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus(); }, [p?.id]);
  // Escape (and Done) put the focus back on the card that opened the sheet.
  useEffect(() => {
    if (!p) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') document.getElementById(`sc-${p.id}-btn`)?.focus(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [p?.id]);
  if (!item) return null;

  const done = () => { close(); document.getElementById(`sc-${item.id}-btn`)?.focus(); };
  const avail = measuresOf(item.track);
  const keys = MEASURES.filter((k) => avail.has(k));
  const relative = item.track.derived.hdopRelative;
  const computed = (k: MeasureKey) => k === 'grade' || k === 'accel' || (k === 'speed' && !item.track.derived.speedFromFile);
  const graphOn = S.showHaloGraph.value && item.halo !== 'off';

  return (
    <div class="settings-sheet" role="dialog" aria-labelledby="settings-title" ref={ref}>
      <div class="sheet-head">
        <Badge item={item} size="small" />
        <h2 id="settings-title">{t('settings.title')}</h2>
        <span class="grow" />
        <button type="button" class="btn-outline small" title={t('colorHalo.swap')} onClick={() => S.swapMeasures(item.id)}>
          <IconSwap size={14} />{t('colorHalo.swapShort')}
        </button>
        <button type="button" class="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={done}><IconClose /></button>
      </div>
      <table class="sheet-table">
        <thead>
          <tr><th scope="col">{t('settings.measure')}</th><th scope="col">{t('colorHalo.color')}</th><th scope="col">{t('colorHalo.halo')}</th></tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th scope="row">
                <span class="opt-title">
                  <span class="opt-name">{measureTitle(k, k === 'hdop' && relative)}</span>
                  {computed(k) && <span class="computed-tag"><IconCalc size={11} />{t('computed.tag')}</span>}
                </span>
                <span class="opt-desc">{t(`measure.${k}.long`)}</span>
                {k === 'hdop' && relative && <span class="opt-note">{t('measure.hdop.relativeNote')}</span>}
              </th>
              <td><input type="radio" name={`color-${item.id}`} checked={item.color === k} aria-label={t('settings.asColor', { m: measureName(k) })} onChange={() => S.setMeasure(item.id, 'color', k)} /></td>
              <td><input type="radio" name={`halo-${item.id}`} checked={item.halo === k} aria-label={t('settings.asHalo', { m: measureName(k) })} onChange={() => S.setMeasure(item.id, 'halo', k)} /></td>
            </tr>
          ))}
          <tr class="none-row">
            <th scope="row"><span class="opt-name">{t('settings.none')}</span><span class="opt-desc">{t('settings.noneColor')}</span><span class="opt-desc">{t('settings.noneHalo')}</span></th>
            <td><input type="radio" name={`color-${item.id}`} checked={item.color === 'none'} aria-label={t('settings.noColor')} onChange={() => S.setMeasure(item.id, 'color', 'none')} /></td>
            <td><input type="radio" name={`halo-${item.id}`} checked={item.halo === 'off'} aria-label={t('settings.noHalo')} onChange={() => S.setMeasure(item.id, 'halo', 'off')} /></td>
          </tr>
        </tbody>
      </table>
      {/* Kept in view at the bottom: the switch sits under the Halo column (it adds the halo measure's own graph), then Done. */}
      <div class="sheet-foot">
        <div class="graph-row">
          <span id="settings-graph" class="graph-label">{t('settings.haloGraph')}</span>
          <span />
          <button
            type="button" role="switch" class="switch" aria-checked={graphOn ? 'true' : 'false'} aria-labelledby="settings-graph"
            disabled={item.halo === 'off'} onClick={() => { S.showHaloGraph.value = !S.showHaloGraph.value; }}
          >
            <span class="knob" aria-hidden="true" />
          </button>
        </div>
        <div class="done-row"><button type="button" class="btn-dark small" onClick={done}>{t('settings.done')}</button></div>
      </div>
    </div>
  );
}
