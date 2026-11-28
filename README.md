# Track Log Plotter

[简体中文](README.zh-CN.md)

Plot GPS track logs on a map, in your browser. Open your logs and see them on a zoomable map, colored by speed, elevation, grade, HDOP, satellites used, fix type or acceleration, with a second measure shown as a halo around the line.

**Use it:** https://ricebucket.github.io/track-log-plotter/

**Demo video:** [watch it](docs/video/demo-en.mp4)

![Track Log Plotter: a ride around Central Park and a run around Roosevelt Island on a light basemap, the track list with a speed legend and an HDOP halo key, a fix card on the map, and the timeline with one lane per track](docs/screenshots/desktop-en.png)

## What it does

- **Several tracks.** Up to ten loaded and three shown at once; one button hides them all and brings the same ones back. Each track has a letter whose shape shows its file type. One track on its own gets broad multi-hue colors; with several, each track has its own color range so they stay apart.
- **Rename and remove.** Click the selected track's name, or press F2, to give it a name of your own; its properties page still shows the file's name. Press Select, tick several tracks and press Remove to remove them all at once.
- **Combine logs of one trip.** Carried two or three loggers together? Press Select, tick 2 or 3 of their tracks and press Combine. Their clocks are lined up first; then the position, elevation and speed at each moment are an average of the sources, weighted by how accurate each one is there, and a source too far from the others at a moment is left out. The combined track lists its sources, each with an eye that shows its own line on the map, and a Trust handle moves the weight toward one of them. It keeps its own copy of each source, so the tracks it came from stay as they were.
- **Color and halo.** Each track's card shows what colors the line, what the halo shows and what the timeline graphs. Click the card for a sheet listing every measure the file has, with a full description: pick one for the color and one for the halo (or neither), swap them, and add the halo measure's graph to the timeline. The halo widens toward the far end of its measure, so two measures read at once.
- **Timeline.** One lane per shown track and a shared cursor; the selected track's lane is a graph filled with its map colors, and can add a second graph of its halo measure. The cursor snaps to the nearest fix; scroll or drag across the timeline to zoom in, and Reset zoom zooms back out. Drag along a track on the map to move the cursor there too, or press play to replay the tracks in a loop (gaps are skipped). Tracks recorded at the same time line up by clock (two loggers carried together); a track recorded at another time lines up at its start. Logs that run past midnight or over several days show their dates.
- **Fix card.** The cursor shows every value at that moment: position (latitude and longitude), speed, elevation, height above the ellipsoid, grade, HDOP, VDOP, PDOP, satellites used, fix type, course, button presses and the line in the file. The measures on the color and the halo are highlighted, with the line's color and the halo's width at that fix.
- **Computed values are marked.** Anything the app works out itself, such as grade, distance or speed from positions, carries a calculator icon that explains how.
- **Damaged logs still load.** Glued sentences are split and stray bytes removed; a cut-off last line, bad checksums, time running backwards and impossible jumps are skipped. Each is listed on the track's properties page.
- **Keyless basemaps.** OpenStreetMap, OpenFreeMap Light and Dark, OpenTopoMap and Esri World Imagery (satellite and hybrid), with links that open the same spot in Google Maps, and Street View at the selected fix.
- **Motion data.** Logs recorded with a motion sensor on add an Acceleration measure: the strongest accelerometer reading in each second, gravity included (about 1 g at rest). The map and the timeline color each second by it, and the fix card lists all of that second's readings with the strongest and the median marked.
- **Time zones.** Local time, UTC or any zone. A file whose times have no zone is read as UTC until you set the zone it was recorded in, on its properties page.
- **English and 简体中文**, switched in the Options menu (top right), on desktops and phones. English shows 12-hour times, Chinese 24-hour.

Tracks that cross 180° longitude (the antimeridian) aren't supported yet.

## Privacy

Your track files never leave your device: they are read in your browser and never uploaded. To draw the map, your browser requests:

- map tiles from the basemap you pick (that provider sees which area you view),
- the lettering of the labels on the tracks from OpenFreeMap, whichever basemap you pick (OpenFreeMap sees your IP address, not the area you view), and
- the Overpass fonts from Google Fonts (Google receives your IP address and browser details).

Your settings (language, basemap, units, time zone, display switches and layout) are saved in your browser. There are no analytics and no cookies.

## Basemaps and attribution

| Basemap | Provider |
| --- | --- |
| OpenStreetMap | © OpenStreetMap contributors |
| Light, Dark | OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors |
| Topographic | © OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors, SRTM |
| Satellite, Hybrid | Esri World Imagery: Esri, Maxar, Earthstar Geographics and the GIS User Community |

The app shows each provider's attribution on the map.

## Development

To run it on your computer, with a current Node.js (the minimum is `engines` in package.json):

```sh
npm install
npm run dev
```

[DEVELOPMENT.md](DEVELOPMENT.md) covers setup, commands, tests, deployment and the checks to run before every push.

## License

GPL-3.0. See [LICENSE](LICENSE).
