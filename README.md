# Guangdong Wind Watch · 广东实况风场

A live weather-observation map for Guangdong. When you open it, the first thing you see is the wind at more than 5,000 automatic weather stations across the province, each drawn as a meteorological wind barb and coloured by Beaufort force. The map refreshes on its own every five minutes.

## Features

- **Province-wide wind barb map**: every station is plotted from the latest observation. You can switch between the 10-minute mean wind and the hourly maximum gust. Where barbs would overlap, they are thinned on a screen grid and the strongest wind in each cell is kept. You can change the density or show every station.
- **Distribution at a glance**: a Beaufort-force histogram, a wind-direction rose, a count of stations at force 6 or above, and a list of the strongest stations. All of these can be filtered by prefecture city (21 cities plus offshore/border stations).
- **Full station observations**: click any barb to open the station's name, location and latest 10-min, 2-min and gust wind, temperature (with high/low), humidity, pressure and rainfall (1/3/6/12/24/72 h). It also shows 12-hour charts for wind (with barbs), temperature, humidity, pressure and hourly rain.
- **Auto-refresh**: a countdown shows when the next update is due. Data also reloads when you return to the tab if it has gone stale. The open station panel refreshes along with the map.

## Data source

Observations come from the Guangdong meteorological automatic-station network, as published by 揭阳台风网 (http://218.17.86.92/city/jieyang/index.html). Two Netlify Functions proxy the site's JSON service:

| Endpoint | Upstream method | Notes |
| --- | --- | --- |
| `GET /api/wind?field=mean\|gust` | `GetLastOBTWindInfo` (74 / 79) | All stations. The source returns Web-Mercator pixel positions, which the function converts back to lat/lon. |
| `GET /api/station/:id` | `GetOBTWindStatus` | One station's metadata and its last ~12 h of observations, converted to real units. |

Responses are cached on Netlify's CDN for 3 minutes. Many viewers therefore produce only a few upstream requests.

On the map, barbs show Beaufort force, because the bulk feed only provides force levels. Barbs follow the CMA convention: half barb = 2 m/s, full = 4 m/s, pennant = 20 m/s, drawn at the middle of each force range. The station panel shows exact speeds in m/s.

## Tech

- Vite + TypeScript (no framework), Leaflet with CARTO dark basemap tiles
- A custom canvas layer for fast barb rendering
- Netlify Functions (TypeScript) for the data proxy, with Netlify CDN caching
- Bundled Guangdong prefecture boundaries (`public/data/guangdong.json`, from DataV.GeoAtlas)

## Running locally

```bash
npm install
netlify dev         # serves the site and the /api functions together
