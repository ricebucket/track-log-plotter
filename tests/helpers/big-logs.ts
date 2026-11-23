// Large synthetic logs for the performance tests: New York City only.

const pad = (v: number) => String(v).padStart(2, '0');

/**
 * A Columbus Fusion log looping around Central Park: a fix a second, each with
 * ten accelerometer readings (one in the fix row, nine after it). Ten hours is
 * 36,000 fixes and 360,000 readings, about 10 MB.
 */
export function bigFusionLog(hours: number): string {
  const out = ['# Format=ColumbusFusion; Version=1.0; Type=GNSS+IMU', 'tag,date,time,lat,lon,alt,speed,heading,ax,ay,az'];
  for (let i = 0; i < hours * 3600; i++) {
    const time = `${pad(Math.floor(i / 3600))}${pad(Math.floor(i / 60) % 60)}${pad(i % 60)}`;
    const lat = (40.7812 + 0.01 * Math.sin(i / 600)).toFixed(7);
    const lon = (-73.9665 + 0.008 * Math.cos(i / 600)).toFixed(7);
    out.push(`${i ? '' : 'T'},${i ? '' : '260614'},${time},${lat},${lon},25.0,18.0,90.0,0.05,0.12,0.99`);
    for (let k = 1; k < 10; k++) out.push(`,,,,,,,,${(0.05 + ((i + k) % 7) * 0.01).toFixed(2)},0.12,${(0.95 + ((i * k) % 9) * 0.01).toFixed(2)}`);
  }
  return out.join('\r\n') + '\r\n';
}
