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

/**
 * A GPX log looping around Central Park: a point a second with elevation,
 * satellites, HDOP and Garmin speed and course. 50,000 points is about 14 MB.
 */
export function bigGpxLog(points: number): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><trk><trkseg>'];
  const t0 = Date.UTC(2026, 5, 14, 8, 0, 0);
  for (let i = 0; i < points; i++) {
    const lat = (40.7812 + 0.01 * Math.sin(i / 600)).toFixed(7), lon = (-73.9665 + 0.008 * Math.cos(i / 600)).toFixed(7);
    const time = new Date(t0 + i * 1000).toISOString().replace('.000Z', 'Z');
    const ext = `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${(3 + (i % 5) * 0.2).toFixed(2)}</gpxtpx:speed><gpxtpx:course>${(i % 360).toFixed(1)}</gpxtpx:course></gpxtpx:TrackPointExtension></extensions>`;
    out.push(`<trkpt lat="${lat}" lon="${lon}"><ele>${(20 + 5 * Math.sin(i / 300)).toFixed(1)}</ele><time>${time}</time><sat>${7 + (i % 4)}</sat><hdop>${(0.8 + (i % 7) * 0.1).toFixed(1)}</hdop>${ext}</trkpt>`);
  }
  out.push('</trkseg></trk></gpx>');
  return out.join('\n');
}

/** An NMEA sentence with its checksum. */
export function nmeaSentence(body: string): string {
  let c = 0;
  for (let i = 0; i < body.length; i++) c ^= body.charCodeAt(i);
  return `$${body}*${c.toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * An NMEA log looping around Central Park: RMC, GGA and GSA each second.
 * 36,000 fixes is about 7 MB. `northM` moves every fix that far north, so it
 * can stand for a second logger on the same walk.
 */
export function bigNmeaLog(fixes: number, northM = 0): string {
  const out: string[] = [];
  for (let i = 0; i < fixes; i++) {
    const hms = `${pad(8 + Math.floor(i / 3600))}${pad(Math.floor(i / 60) % 60)}${pad(i % 60)}.00`;
    const lat = 40.7812 + 0.01 * Math.sin(i / 600) + northM / 110_540, lon = 73.9665 - 0.008 * Math.cos(i / 600);
    const la = `${Math.floor(lat)}${((lat % 1) * 60).toFixed(5).padStart(8, '0')}`;
    const lo = `0${Math.floor(lon)}${((lon % 1) * 60).toFixed(5).padStart(8, '0')}`;
    out.push(nmeaSentence(`GPRMC,${hms},A,${la},N,${lo},W,5.20,${(i % 360).toFixed(1)},140626,13.1,W,A`));
    out.push(nmeaSentence(`GPGGA,${hms},${la},N,${lo},W,1,09,0.9,21.5,M,-34.2,M,,`));
    out.push(nmeaSentence('GPGSA,A,3,2,5,6,9,12,13,15,17,19,,,,1.6,0.9,1.3'));
  }
  return out.join('\r\n') + '\r\n';
}
