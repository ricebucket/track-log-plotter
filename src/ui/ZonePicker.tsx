import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as S from '../state/store';
import { t } from '../state/store';
import { searchZones } from '../time/zones';
import { useDismiss } from './hooks';
import { IconClose, IconSearch } from './icons';

/** A searchable list of every time zone the browser knows. */
export function ZonePicker({ at }: { at: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const close = () => { S.zoneOpen.value = false; };
  useDismiss(ref, close);
  useEffect(() => { input.current?.focus(); }, []);
  const list = useMemo(() => searchZones(q, at), [q, at]);
  return (
    <div class="popover zone-picker" role="dialog" aria-labelledby="zone-h" ref={ref}>
      <div class="picker-head">
        <h2 id="zone-h">{t('zone.pick')}</h2>
        <button type="button" class="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={close}><IconClose /></button>
      </div>
      <label class="search">
        <IconSearch />
        <input ref={input} type="search" value={q} placeholder={t('zone.search')} aria-label={t('zone.search')} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <div class="zone-list" role="radiogroup" aria-labelledby="zone-h">
        {list.slice(0, 200).map((z) => (
          <button key={z.id} type="button" role="radio" aria-checked={S.zone.value === z.id ? 'true' : 'false'} onClick={() => { S.zone.value = z.id; close(); }}>
            <span class="zone-name"><span>{z.city}</span><span class="mono muted small">{z.id}</span></span>
            <span class="mono small">{z.offset}</span>
          </button>
        ))}
        {list.length === 0 && <span class="muted small">{t('zone.none')}</span>}
      </div>
      <span class="muted small">{t('zone.note')}</span>
    </div>
  );
}
