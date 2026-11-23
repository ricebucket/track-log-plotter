import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import * as S from '../state/store';
import { t } from '../state/store';
import { Panel, PanelButton } from './Panel';
import { Timeline, TimelineButton } from './Timeline';
import { MeasurePicker } from './MeasurePicker';
import { MapFooter, MapTools } from './MapTools';
import { Tooltip } from './Tooltip';
import { Toasts } from './Toasts';
import { EmptyState } from './EmptyState';
import { IconUpload } from './icons';
import { HintLayer, hint } from './Computed';
import { ZonePicker } from './ZonePicker';

const ACCEPT = '.gpx,.GPX,.nmea,.NMEA,.nma,.log,.LOG,.txt,.csv,.CSV';

export function App({ Map }: { Map: ComponentType }) {
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
    return () => {
      document.removeEventListener('pointerdown', unpin);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const loaded = S.items.value.length > 0;
  const clockItem = S.clockPicker.value ? S.items.value.find((x) => x.id === S.clockPicker.value) : undefined;
  const cls = ['app', S.panelMin.value || !loaded ? 'panel-min' : '', S.timelineMin.value || !loaded ? 'timeline-min' : ''].filter(Boolean).join(' ');
  return (
    <div class={cls}>
      <Map />
      {loaded ? (
        <>
          {S.panelMin.value ? <PanelButton /> : <Panel />}
          {S.timelineMin.value ? <TimelineButton /> : <Timeline />}
          <Tooltip />
          {S.picker.value && <MeasurePicker />}
          {S.zoneOpen.value && (
            <ZonePicker
              at={S.cursorT.value ?? S.selected.value?.track.derived.stats.start ?? 0} value={S.zone.value} title={t('zone.pick')}
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
