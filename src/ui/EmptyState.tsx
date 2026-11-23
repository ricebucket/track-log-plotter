import * as S from '../state/store';
import { t } from '../state/store';
import { openFilePicker } from './Panel';
import { IconFolder, IconLock, IconUpload } from './icons';

/** Before any track is open. */
export function EmptyState() {
  const loading = S.loadingCount.value > 0;
  return (
    <>
      <div class="brand-pill">
        <span class="app-title">{t('app.name')}</span>
      </div>
      <div class="empty-wrap">
        <main class="empty-card" aria-labelledby="empty-h">
          <div class="empty-text">
            <h1 id="empty-h">{t('empty.title')}</h1>
            <p>{t('empty.desc')}</p>
          </div>
          <div class="empty-actions">
            <button type="button" class="btn-dark big" onClick={openFilePicker} disabled={loading}><IconFolder />{t('empty.open')}</button>
            <button type="button" class="btn-outline big" onClick={() => { void S.loadSample(); }} disabled={loading}>{t('empty.sample')}</button>
          </div>
          <div class="drop-hint"><IconUpload /><span>{loading ? t('empty.loading') : t('empty.drop')}</span></div>
          <div class="supports">
            <span class="eyebrow">{t('empty.supports')}</span>
            <span class="pill">GPX</span>
            <span class="pill">NMEA</span>
            <span class="pill">Columbus Fusion</span>
          </div>
          <div class="privacy"><IconLock /><span>{t('empty.privacy')}</span></div>
        </main>
      </div>
    </>
  );
}
