# AGENTS.md

## What this is
A single-screen live wind map for Guangdong. It uses Vite + vanilla TypeScript on the frontend and Leaflet for the map. Two Netlify Functions proxy an external ASP.NET JSON service at `http://218.17.86.92/backService/api.asmx`. No database: all data is live upstream data, cached on the Netlify CDN (`Netlify-CDN-Cache-Control`, 180 s, durable, stale-while-revalidate).

## Layout
- `index.html`: page shell (side panel, legend, station drawer containers).
- `src/main.ts`: app state, map setup, panel rendering (KPIs, histogram, direction rose, top list), controls, and the 5-minute auto-refresh loop.
- `src/barbLayer.ts`: a canvas drawn over the Leaflet map. It handles grid-based decluttering (strongest wins) and hit testing for hover and click. It is not an `L.Layer`. It redraws on `move`/`zoomend`.
- `src/wind.ts`: Beaufort tables, colour bands, and `barbShape()`, which returns SVG path strings. The canvas (via `Path2D`) and the SVG charts both use it.
- `src/detail.ts`: the station drawer and its hand-rolled SVG charts.
- `src/geo.ts`: point-in-polygon lookup that assigns stations to prefecture cities.
- `src/api.ts`: client fetchers and shared types.
- `netlify/functions/wind.mts` → `/api/wind`; `netlify/functions/station.mts` → `/api/station/:id`.
- `netlify/lib/source.mts`: upstream call helper, date parsing, and cache headers. It lives outside `netlify/functions` so it isn't deployed as a function.

## Upstream quirks (important)
- `GetLastOBTWindInfo` returns **canvas pixel positions**, not coordinates. Coordinates are recovered by sending a large Web-Mercator canvas (1000 px/°) and inverting it (~0.001° error; positions are close to GCJ-02). `v0` is **Beaufort force** (integer), and `v1` is the direction the wind comes from. windField `74` = 10-min mean, `79` = hourly max gust.
- `GetOBTWindStatus` values are integers in tenths (wind m/s, °C, hPa, rain mm). Humidity and pressure are `0` when the station lacks the sensor, and we treat that as missing.
- `/Date(ms)/` values are **Beijing wall-clock encoded as UTC**. Subtract 8 h (`parseSourceDate`). `currentTime` must be sent as a Beijing wall-clock string without a zone (`beijingNowString`).
- Station names exist only in the per-station endpoint. The "Strongest stations" list fetches them lazily.

## Conventions
- TypeScript everywhere; functions use the modern `export default` + `config.path` format.
- The UI is English, and station and city names stay in Chinese as provided by the source.
- Colours for force bands live only in `BANDS` in `src/wind.ts`. Reuse `forceColor()`.
