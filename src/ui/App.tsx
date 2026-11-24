import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { useComputed } from '@preact/signals';
import * as S from '../state/store';
import { t } from '../state/store';
import { Panel, PanelButton } from './Panel';
import { Timeline, TimelineButton } from './Timeline';
import { SettingsSheet } from './SettingsSheet';
import { MapFooter, MapTools } from './MapTools';
import { Tooltip } from './Tooltip';
import { Toasts } from './Toasts';
import { EmptyState } from './EmptyState';
import { IconUpload } from './icons';
import { HintLayer, hint } from './Computed';
import { TipLayer } from './TipLayer';
import { ZonePicker } from './ZonePicker';
import { NARROW, useMedia } from './hooks';

const ACCEPT = '.gpx,.GPX,.nmea,.NMEA,.nma,.log,.LOG,.txt,.csv,.CSV';

export function App({ Map }: { Map: ComponentType }) {
  // On a phone the time zone list also offers Local and UTC (the header has one zone button).
  const narrow = useMedia(NARROW);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void S.openFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    const unpin = () => { if (hint.value?.pinned) hint.value = null; };
    document.addEventListener('pointerdown', unpin);
    // Escape closes an explanation, pinned or shown on hover or focus, and keeps the key: select mode stays on.
    const dismiss = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !hint.peek()) return;
      hint.value = null;
      e.preventDefault();
    };
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', unpin);
      document.removeEventListener('keydown', dismiss);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  // Whether any track is loaded, rather than the list itself: a new name or trust share doesn't redraw the whole app.
  const loaded = useComputed(() => S.items.value.length > 0).value;
  const clockItem = S.clockPicker.value ? S.items.value.find((x) => x.id === S.clockPicker.value) : undefined;
  // The time zone list's offsets are for the cursor's time as the list opens: read without following
  // the cursor, which would redraw the app and search the zones again at every move.
  const zoneAt = S.zoneOpen.value ? S.cursorT.peek() ?? S.selected.value?.track.derived.stats.start ?? 0 : 0;
  const cls = ['app', S.panelMin.value || !loaded ? 'panel-min' : '', S.timelineMin.value || !loaded ? 'timeline-min' : ''].filter(Boolean).join(' ');
  return (
    <div class={cls}>
      <Map />
      {loaded ? (
        <>
          {S.panelMin.value ? <PanelButton /> : <Panel />}
          {S.timelineMin.value ? <TimelineButton /> : <Timeline />}
          <Tooltip />
          {S.picker.value && <SettingsSheet />}
          {S.zoneOpen.value && (
            <ZonePicker
              at={zoneAt} value={S.zone.value} title={t('zone.pick')} quick={narrow}
              onPick={(z) => { S.zone.value = z; }} onClose={() => { S.zoneOpen.value = false; }} trigger="[data-zone-trigger]"
            />
          )}
          {clockItem?.track.clock && (
            <ZonePicker
              at={clockItem.track.cols.t[0]} value={clockItem.track.clock} title={t('clock.pick', { id: clockItem.id })} quick className="clock"
              onPick={(z) => S.setClock(clockItem.id, z)} onClose={() => { S.clockPicker.value = null; }} trigger="[data-clock-trigger]"
            />
          )}
        </>
      ) : (
        <EmptyState />
      )}
      <MapTools />
      <MapFooter />
      <Toasts />
      <HintLayer />
      <TipLayer />
      {dragging && (
        <div class="drop-overlay" aria-hidden="true"><div><IconUpload size={28} /><span>{t('drop.overlay')}</span></div></div>
      )}
      <input
        id="tlp-file-input" class="sr-only" type="file" multiple accept={ACCEPT} tabIndex={-1} aria-hidden="true"
        onChange={(e) => {
          const el = e.currentTarget as HTMLInputElement;
          const files = [...(el.files ?? [])];
          el.value = '';
          void S.openFiles(files);
        }}
      />
    </div>
  );
}
