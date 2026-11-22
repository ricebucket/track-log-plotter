import * as S from '../state/store';
import { t } from '../state/store';
import { mapFailed } from '../map/bridge';
import { IconClose, IconWarn } from './icons';

/** Notices after loading: damaged files, files that couldn't be read, the load limit. */
export function Toasts() {
  const n = S.loadNotice.value;
  const errs = S.loadErrors.value;
  const skipped = S.skippedCount.value;
  return (
    <div class="toasts">
      {mapFailed.value && <div class="toast is-error" role="alert"><IconWarn size={16} /><span>{t('toast.noMap')}</span></div>}
      {n && (
        <div class="toast" role="status">
          <IconWarn size={16} />
          <span>{t('toast.problems', { file: n.file, n: n.problems })}</span>
          <button type="button" class="btn-amber" onClick={() => S.openDetails(n.id)}>{t('toast.showDetails')}</button>
          <button type="button" class="icon-btn" aria-label={t('common.dismiss')} title={t('common.dismiss')} onClick={() => { S.loadNotice.value = null; }}><IconClose size={14} /></button>
        </div>
      )}
      {errs.length > 0 && (
        <div class="toast is-error" role="alert">
          <IconWarn size={16} />
          <span>{errs.map((e) => t(`toast.error.${e.error}`, { file: e.file })).join(' ')}</span>
          <button type="button" class="icon-btn" aria-label={t('common.dismiss')} title={t('common.dismiss')} onClick={() => { S.loadErrors.value = []; }}><IconClose size={14} /></button>
        </div>
      )}
      {skipped > 0 && (
        <div class="toast" role="status">
          <IconWarn size={16} />
          <span>{t('toast.skipped', { n: skipped })}</span>
          <button type="button" class="icon-btn" aria-label={t('common.dismiss')} title={t('common.dismiss')} onClick={() => { S.skippedCount.value = 0; }}><IconClose size={14} /></button>
        </div>
      )}
    </div>
  );
}
