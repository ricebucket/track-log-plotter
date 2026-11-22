/** A distance that fits about 100 px at the map's zoom, for the scale bar. */
export function scaleBar(lat: number, zoom: number, imperial: boolean): { px: number; value: number; unit: 'm' | 'km' | 'ft' | 'mi' } {
  const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  const maxM = mpp * 110;
  const nice = (x: number) => { const p = 10 ** Math.floor(Math.log10(x)); const f = x / p; return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p; };
  if (imperial) {
    const ft = maxM * 3.28084;
    if (ft < 5280) { const v = nice(ft); return { px: v / 3.28084 / mpp, value: v, unit: 'ft' }; }
    const v = nice(ft / 5280); return { px: (v * 1609.344) / mpp, value: v, unit: 'mi' };
  }
  if (maxM < 1000) { const v = nice(maxM); return { px: v / mpp, value: v, unit: 'm' }; }
  const v = nice(maxM / 1000); return { px: (v * 1000) / mpp, value: v, unit: 'km' };
}
