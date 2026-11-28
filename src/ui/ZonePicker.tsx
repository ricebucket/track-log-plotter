import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../state/store';
import { offsetLabel, searchZones, type ZoneSel } from '../time/zones';
import { useDismiss } from './hooks';
import { IconClose, IconSearch } from './icons';

interface Props {
  /** A time near which offsets are shown. */
  at: number;
  value: ZoneSel;
  onPick: (z: ZoneSel) => void;
  onClose: () => void;
  /** CSS selector of the button that opens the list (a press on it toggles the list). */
  trigger: string;
  title: string;
  /** Offer this device's zone and UTC at the top of the list. */
  quick?: boolean;
  className?: string;
}

/** A searchable list of every time zone the browser knows. */
export function ZonePicker({ at, value, onPick, onClose, trigger, title, quick = false, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  useDismiss(ref, onClose, trigger);
  // The focus moves into the search box as the list opens. When the list closes with the focus inside it
  // (Escape, its Close button, a zone picked), the focus goes back to the button that opened it.
  useEffect(() => {
    const box = ref.current;
    input.current?.focus();
    return () => {
      const focused = document.activeElement;
      if (!focused || focused === document.body || box?.contains(focused)) document.querySelector<HTMLElement>(trigger)?.focus();
    };
  }, []);
  const list = useMemo(() => searchZones(q, at), [q, at]);
  const pick = (z: ZoneSel) => { onPick(z); onClose(); };
  const option = (id: ZoneSel, name: string, sub: string, offset: string) => (
    <button key={id} type="button" role="radio" aria-checked={value === id ? 'true' : 'false'} onClick={() => pick(id)}>
      <span class="zone-name"><span>{name}</span>{sub && <span class="mono muted small">{sub}</span>}</span>
      <span class="mono small">{offset}</span>
    </button>
  );
  return (
    <div class={`popover zone-picker ${className}`} role="dialog" aria-labelledby="zone-h" ref={ref}>
      <div class="picker-head">
        <h2 id="zone-h">{title}</h2>
        <button type="button" class="icon-btn" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}><IconClose /></button>
      </div>
      <label class="search">
        <IconSearch />
        <input ref={input} type="search" value={q} placeholder={t('zone.search')} aria-label={t('zone.search')} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <div class="zone-list" role="radiogroup" aria-labelledby="zone-h">
        {quick && !q && [option('local', t('clock.thisDevice'), '', offsetLabel(at, 'local')), option('utc', 'UTC', '', 'UTC')]}
        {list.map((z) => option(z.id, z.city, z.name, z.offset))}
        {list.length === 0 && <span class="muted small">{t('zone.none')}</span>}
      </div>
      <span class="muted small">{t('zone.note')}</span>
    </div>
  );
}
