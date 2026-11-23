// A track's letter badge: its color is the track's color range (gray while
// hidden), and its shape says which kind of file the track came from.
import type { Format } from '../model/types';
import type { TrackItem } from '../state/logic';
import { FAMILIES, HIDDEN_BADGE } from '../color/palettes';
import { FORMAT_SHAPE } from '../color/shapes';
import { formatName } from './labels';

export function badgeOf(it: TrackItem): string {
  return it.vis ? FAMILIES[it.fam % 3].badge : HIDDEN_BADGE;
}

export function Badge({ item, size }: { item: TrackItem; size?: 'small' | 'tiny' | 'big' }) {
  const f = item.track.format;
  return (
    <span class={`badge ${FORMAT_SHAPE[f]}${size ? ` ${size}` : ''}`} style={{ background: badgeOf(item) }} title={formatName(f)}>
      {item.id}
    </span>
  );
}

/** A format's shape on its own: the key on the start screen. */
export function FormatShape({ format }: { format: Format }) {
  return <span class={`badge-shape ${FORMAT_SHAPE[format]}`} aria-hidden="true" />;
}
