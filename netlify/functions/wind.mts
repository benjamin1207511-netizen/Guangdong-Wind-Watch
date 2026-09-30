import type { Config } from "@netlify/functions"
import { fetchOffshore } from "../lib/offshore.mts"
import { BOUNDS, beijingNowString, cachedJson, callSource, parseSourceDate } from "../lib/source.mts"

// windField codes used by the source: 74 = latest 10-minute mean wind,
// 79 = maximum gust within the latest hour.
const FIELDS = { mean: 74, gust: 79 } as const

// The source returns canvas pixel positions (Web Mercator) instead of lat/lon.
// Requesting a large canvas keeps the round-trip error around 0.001°.
const PX_PER_DEG = 1000

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const invMercY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90

interface RawPoint {
  id: string
  v0: number // Beaufort force
  v1: number // direction the wind blows from, degrees
  x: number
  y: number
}

export default async (req: Request) => {
  const kind = new URL(req.url).searchParams.get("field") === "mean" ? "mean" : "gust"

  const width = Math.round((BOUNDS.east - BOUNDS.west) * PX_PER_DEG)
  const yTop = mercY(BOUNDS.north)
  const yBottom = mercY(BOUNDS.south)
  const height = Math.round(((yTop - yBottom) * 180) / Math.PI * PX_PER_DEG)

  try {
    const [raw, reference, offshore] = await Promise.all([
      callSource<string>("GetLastOBTWindInfo", {
        windField: FIELDS[kind],
        minLatLng: [BOUNDS.south, BOUNDS.west],
        maxLatLng: [BOUNDS.north, BOUNDS.east],
        canvasSize: [width, height],
        minSpace: 0,
      }),
      // A national reference station (Guangzhou) tells us the observation time.
      callSource<{ HISTORY?: { DDATETIME: string }[] } | null>("GetOBTWindStatus", {
        strOBTID: "59287",
        currentTime: beijingNowString(),
      }).catch(() => null),
      // Offshore platforms and islands missing from the barb layer.
      fetchOffshore(kind).catch(() => []),
    ])

    const points = JSON.parse(raw) as RawPoint[]
    const stations = points.map((p) => {
      const lon = BOUNDS.west + (p.x / width) * (BOUNDS.east - BOUNDS.west)
      const lat = invMercY(yTop - (p.y / height) * (yTop - yBottom))
      return [p.id, +lat.toFixed(4), +lon.toFixed(4), p.v0, p.v1] as const
    })

    const history = reference?.HISTORY ?? []
    const observedAt = history.length ? parseSourceDate(history[history.length - 1].DDATETIME) : null

    return cachedJson(
      {
        field: kind,
        observedAt,
        fetchedAt: new Date().toISOString(),
        // Compact rows: [id, lat, lon, beaufortForce, directionDeg]
        stations,
        // Stations absent from the layer above, read one by one:
        // [id, lat, lon, speedMs, directionDeg, name]
        offshore: offshore
          .filter((o) => !stations.some((s) => s[0] === o.id))
          .map((o) => [o.id, o.lat, o.lon, o.speed, o.dir, o.name] as const),
      },
      180,
    )
  } catch (err) {
    console.error("wind fetch failed", err)
    return Response.json({ error: "The observation source is temporarily unavailable." }, { status: 502 })
  }
}

export const config: Config = {
  path: "/api/wind",
}
