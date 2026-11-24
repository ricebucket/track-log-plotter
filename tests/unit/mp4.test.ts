// The MP4 writer of the demo videos (tests/video/mp4.ts).
import { describe, expect, it } from 'vitest';
import { mp4 } from '../video/mp4';

/** The boxes of `buf` from `start` to `end`: type, where its contents are, and their length. */
function boxes(buf: Buffer, start = 0, end = buf.length) {
  const out: { type: string; body: number; length: number }[] = [];
  for (let at = start; at < end;) {
    const size = buf.readUInt32BE(at);
    out.push({ type: buf.toString('latin1', at + 4, at + 8), body: at + 8, length: size - 8 });
    at += size;
  }
  return out;
}

/** The box at a path of types, such as ['moov', 'trak', 'mdia']. */
function find(buf: Buffer, path: string[]) {
  let start = 0, end = buf.length;
  let found: { type: string; body: number; length: number } | undefined;
  for (const type of path) {
    found = boxes(buf, start, end).find((b) => b.type === type);
    if (!found) return null;
    start = found.body;
    end = found.body + found.length;
  }
  return found!;
}

describe('the MP4 writer of the demo videos', () => {
  const samples = [
    { data: Buffer.from([0, 0, 0, 2, 0x65, 1]), key: true },
    { data: Buffer.from([0, 0, 0, 1, 0x41]), key: false },
    { data: Buffer.from([0, 0, 0, 3, 0x65, 2, 3]), key: true },
  ];
  const file = mp4({ width: 1120, height: 1680, timescale: 1000, sampleDuration: 40, description: Buffer.from([1, 0x64, 0, 0x28]), samples });
  const stbl = ['moov', 'trak', 'mdia', 'minf', 'stbl'];

  it('puts the index before the samples, as one sample table for one video track', () => {
    expect(boxes(file).map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(find(file, [...stbl, 'stsd'])).toBeTruthy();
    const hdlr = find(file, ['moov', 'trak', 'mdia', 'hdlr'])!;
    expect(file.toString('latin1', hdlr.body + 8, hdlr.body + 12)).toBe('vide');
  });

  it('gives the frame size, the duration and the key frames', () => {
    const tkhd = find(file, ['moov', 'trak', 'tkhd'])!;
    expect(file.readUInt32BE(tkhd.body + tkhd.length - 8) / 0x10000).toBe(1120);
    expect(file.readUInt32BE(tkhd.body + tkhd.length - 4) / 0x10000).toBe(1680);
    const mvhd = find(file, ['moov', 'mvhd'])!;
    expect(file.readUInt32BE(mvhd.body + 12)).toBe(1000); // timescale
    expect(file.readUInt32BE(mvhd.body + 16)).toBe(120); // 3 × 40 ms
    const stss = find(file, [...stbl, 'stss'])!;
    expect([1, 2].map((i) => file.readUInt32BE(stss.body + 4 + 4 * i))).toEqual([1, 3]);
  });

  it("points the sample table at each sample's bytes", () => {
    const stco = find(file, [...stbl, 'stco'])!, stsz = find(file, [...stbl, 'stsz'])!;
    let at = file.readUInt32BE(stco.body + 8);
    samples.forEach((s, i) => {
      const size = file.readUInt32BE(stsz.body + 12 + 4 * i);
      expect(file.subarray(at, at + size)).toEqual(s.data);
      at += size;
    });
    expect(at).toBe(file.length);
  });
});
