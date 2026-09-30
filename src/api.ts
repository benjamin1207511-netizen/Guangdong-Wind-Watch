import type { Station } from "./barbLayer"
import { msToForce } from "./wind"

export interface WindPayload {
  field: "mean" | "gust"
  observedAt: string | null
  fetchedAt: string
  stations: [string, number, number, number, number][]
  offshore?: [string, number, number, number, number, string][]
}

export interface Obs {
  time: string | null
  wind2: { speed: number | null; dir: number | null }
  wind10: { speed: number | null; dir: number | null }
  gust: { speed: number | null; dir: number | null }
  max10: { speed: number | null; dir: number | null }
  temp: number | null
  tempMax: number | null
  tempMin: number | null
  humidity: number | null
  humidityMin: number | null
  pressure: number | null
  rain: {
    h1: number | null; h3: number | null; h6: number | null;
    h12: number | null; h24: number | null; h72: number | null;
    hour: number | null
  }
}

export interface StationDetail {
  id: string
  name: string
  address: string | null
  lat: number
  lon: number
  elevation: number | null
  latest: Obs | null
  history: Obs[]
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export async function fetchWind(
  field: "mean" | "gust",
  locate: (lat: number, lon: number) => string | null,
) {
  const data = await getJson<WindPayload>(`/api/wind?field=${field}`)
  const stations: Station[] = data.stations.map(([id, lat, lon, force, dir]) => ({
    id, lat, lon, force, dir, city: locate(lat, lon),
  }))
  // Offshore stations come with a speed in m/s rather than a force level.
  for (const [id, lat, lon, speed, dir, name] of data.offshore ?? []) {
    stations.push({ id, lat, lon, force: msToForce(speed), dir, city: locate(lat, lon), name, offshore: true })
  }
  return { ...data, stations }
}

const detailCache = new Map<string, { at: number; data: Promise<StationDetail> }>()

export function fetchStation(id: string): Promise<StationDetail> {
  const hit = detailCache.get(id)
  if (hit && Date.now() - hit.at < 4 * 60_000) return hit.data
  const data = getJson<StationDetail>(`/api/station/${encodeURIComponent(id)}`)
  data.catch(() => detailCache.delete(id))
  detailCache.set(id, { at: Date.now(), data })
  return data
}
