import * as S from '../state/store';
import { t } from '../state/store';
import { mapFailed } from '../map/bridge';
import { APART_M } from '../combine/combine';
import { IconClose, IconWarn } from './icons';
import { metresText } from './labels';
import { focusAfterRender, rowButton } from './hooks';

/** Notices after loading: damaged files, files that couldn't be read, the load limit. */
export function Toasts() {
  const n = S.loadNotice.value;
  const errs = S.loadErrors.value;
  const skipped = S.skippedCount.value;
  const c = S.comboNotice.value;
  return (
    <div class="toasts">
      {mapFailed.value && <div class="toast is-error" role="alert"><IconWarn size={16} /><span>{t('toast.noMap')}</span></div>}
      {n && (
        <div class="toast" role="status">
          <IconWarn size={16} />
          <span>{t('toast.problems', { file: S.nameFor(n.id, n.file), n: n.problems })}</span>
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
      {c && <ComboToast notice={c} />}
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

/** What pressing Combine ran into: a time zone to check, the same recording twice, logs that may not be one trip. */
function ComboToast({ notice: n }: { notice: S.ComboNotice }) {
  const dismiss = () => { S.comboNotice.value = null; };
  const text = n.kind === 'zone' ? t('combine.zone', { file: S.nameFor(n.id, n.file) })
    : n.kind === 'duplicate' ? (n.pair ? t('combine.duplicateOf', { a: n.pair[0], b: n.pair[1] }) : t('combine.duplicate'))
    : n.kind === 'apart' ? t('combine.apart', { distance: metresText(APART_M) })
    : n.kind === 'full' ? t('combine.full')
    : n.kind === 'tooLong' ? t('combine.tooLong')
    : t('combine.empty');
  // The track the time zone notice is about, while it is still in the list: the same letter and the same file.
  const zoneTrack = n.kind === 'zone' && S.items.value.some((x) => x.id === n.id && x.track.file === n.file);
  const showZone = () => {
    if (n.kind !== 'zone') return;
    dismiss();
    if (!S.items.peek().some((x) => x.id === n.id && x.track.file === n.file)) return;
    S.endSelect();
    S.openDetails(n.id);
  };
  const combineAnyway = () => {
    // The notice goes as the track is added: the keyboard moves on to its row.
    const id = n.kind === 'zone' ? S.confirmZone() : S.confirmApart();
    if (id) focusAfterRender(() => rowButton(id));
  };
  return (
    <div class="toast" role="status" data-combo={n.kind}>
      <IconWarn size={16} />
      <span>{text}</span>
      {zoneTrack && <button type="button" class="btn-amber" onClick={showZone}>{t('toast.showDetails')}</button>}
      {(n.kind === 'apart' || (n.kind === 'zone' && n.ids)) && <button type="button" class="btn-amber" onClick={combineAnyway}>{t('combine.anyway')}</button>}
      <button type="button" class="icon-btn" aria-label={t('common.dismiss')} title={t('common.dismiss')} onClick={dismiss}><IconClose size={14} /></button>
    </div>
  );
}
