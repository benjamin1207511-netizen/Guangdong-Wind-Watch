import { beijingNowString, callSource } from "./source.mts"

// Offshore stations (oil/gas platforms, outer islands, offshore wind farms)
// in the northern South China Sea. The source knows them — they answer
// GetOBTWindStatus and GetLocalWeather — but GetLastOBTWindInfo never returns
// them, so they are invisible on the barb layer. Each entry lists the station
// ids in order of preference; platforms often have a primary (主站) and a
// backup (备站) id alongside the one that actually reports.
export const OFFSHORE_STATIONS: string[][] = [
  ["G3589", "G3584", "G3586"], // 恩平EP23-1
  ["G3590", "G3587", "G3588"], // 西江XJ23-1
  ["G3602"], // 西江XJ24-3
  ["G3603"], // 西江XJ30-2
  ["G3600"], // 番禺PY5-1
  ["G3598", "G3592", "G3595"], // 番禺PY30-1
  ["G3601"], // 荔湾LW3-1
  ["G3611", "G3599", "G3593", "G3596"], // 流花LH11-1
  ["G3604"], // 惠州HZ19-2
  ["G3606"], // 惠州HZ21-1
  ["G3605"], // 惠州HZ26-1
  ["G3358"], // 惠州HZ32-2
  ["G3597", "G3591", "G3594"], // 陆丰LF13-1
  ["G3607"], // 陆丰LF13-2
  ["G3609"], // 陆丰LF14-4
  ["G3610"], // 陆丰LF15-1
  ["G3608"], // 陆丰LF7-2
  ["G3612"], // 陆丰LF8-1
  ["G7327"], // 阳江青洲四期 (offshore wind farm)
  ["G7519"], // 海威2号
  ["59681"], // 黄茅洲
  ["G1291"], // 担杆岛担杆头
  ["G1191"], // 内伶仃南
  ["G1776"], // 惠州港口
]

// A station whose latest record lags the freshest offshore record by more
// than this is treated as offline. (The source only returns the last 12 hours
// anyway; comparing stations to each other avoids relying on its clock.)
const MAX_LAG_MS = 3 * 3600_000

export interface OffshoreReading {
  id: string
  name: string
  lat: number
  lon: number
  speed: number // m/s
  dir: number // degrees, direction the wind comes from
  time: number // source timestamp, ms
}

interface Status {
  INFO?: { OBTID: string; OBTNAME: string; LATITUDE: number; LONGITUDE: number }
  HISTORY?: Record<string, number | string>[]
}

const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0)

async function readStation(id: string, field: "mean" | "gust"): Promise<OffshoreReading | null> {
  const data = await callSource<Status | null>("GetOBTWindStatus", { strOBTID: id, currentTime: beijingNowString() }, 8000)
  const last = data?.HISTORY?.[data.HISTORY.length - 1]
  if (!data?.INFO || !last) return null
  const time = Number(/-?\d+/.exec(String(last.DDATETIME))?.[0])
  if (!time) return null

  // Values are tenths of m/s. Some platforms have no gust sensor and report 0,
  // so fall back to the 10-minute maximum and then the 10-minute mean.
  let speed = num(last.WD10DF)
  let dir = num(last.WD10DD)
  if (field === "gust") {
    const candidates: [unknown, unknown][] = [[last.WD3SMAXDF, last.WD3SMAXDD], [last.WD10MAXDF, last.WD10MAXDD]]
    const hit = candidates.find(([s]) => num(s) > 0)
    if (hit) [speed, dir] = [num(hit[0]), num(hit[1])]
  }
  return {
    id: data.INFO.OBTID,
    name: data.INFO.OBTNAME.trim(),
    lat: +data.INFO.LATITUDE.toFixed(4),
    lon: +data.INFO.LONGITUDE.toFixed(4),
    speed: speed / 10,
    dir: dir % 360,
    time,
  }
}

/** Latest reading for every offshore station that is currently reporting. */
export async function fetchOffshore(field: "mean" | "gust"): Promise<OffshoreReading[]> {
  const results = await Promise.all(
    OFFSHORE_STATIONS.map(async (ids) => {
      for (const id of ids) {
        const reading = await readStation(id, field).catch(() => null)
        if (reading) return reading
      }
      return null
    }),
  )
  const live = results.filter((r): r is OffshoreReading => r !== null)
  const newest = Math.max(...live.map((r) => r.time))
  return live.filter((r) => newest - r.time <= MAX_LAG_MS)
}
