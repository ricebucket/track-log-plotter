// @vitest-environment happy-dom
// Hover text for text cut off with an ellipsis: the full text, only while some is hidden.
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { fullTextIfCut } from '../../src/ui/cutText';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { load } from '../helpers/fixtures';

/** Pretends the element shows `shown` pixels of `full` pixels of text (happy-dom lays nothing out). */
function widths(el: Element, full: number, shown: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: full });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: shown });
}

beforeEach(() => S.resetForTests());

describe('fullTextIfCut', () => {
  it('sets the full text as the hover text only while the text is cut off', () => {
    const { container } = render(<span class="name" onMouseEnter={fullTextIfCut('a-long-file-name.gpx')}>a-long-file-name.gpx</span>);
    const el = container.querySelector('.name')!;
    widths(el, 300, 120);
    fireEvent.mouseEnter(el);
    expect(el.getAttribute('data-tip')).toBe('a-long-file-name.gpx');
    // Wider again (the panel grew): the title goes.
    widths(el, 300, 300);
    fireEvent.mouseEnter(el);
    expect(el.hasAttribute('data-tip')).toBe(false);
  });

  it('can measure a part of the element that does the cutting off', () => {
    const { container } = render(
      <button type="button" onMouseEnter={fullTextIfCut('Properties & time zone', (b) => b.querySelector('.btn-label'))}>
        <svg /><span class="btn-label">Properties &amp; time zone</span>
      </button>,
    );
    const button = container.querySelector('button')!;
    widths(button, 200, 200);
    widths(button.querySelector('.btn-label')!, 180, 90);
    fireEvent.mouseEnter(button);
    expect(button.getAttribute('data-tip')).toBe('Properties & time zone');
  });

  it('names a track in the list in full in its hover text when it is cut off (and always: see rename.test.tsx)', () => {
    S.addLoaded([{ ...load('central-park-loop.nmea'), file: 'a-track-log-with-a-name-far-too-long-for-the-panel.nmea' }]);
    const { container } = render(<App Map={() => <div />} />);
    const name = container.querySelector('.track-row .track-name')!;
    widths(name, 420, 180);
    fireEvent.mouseEnter(name);
    expect(name.getAttribute('data-tip')!.split('\n')[0]).toBe('a-track-log-with-a-name-far-too-long-for-the-panel.nmea');
  });
});
