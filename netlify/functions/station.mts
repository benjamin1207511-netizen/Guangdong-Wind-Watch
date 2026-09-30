import type { Config, Context } from "@netlify/functions"
import { beijingNowString, cachedJson, callSource, parseSourceDate } from "../lib/source.mts"

interface RawInfo {
  OBTID: string
  OBTNAME: string
  LONGITUDE: number
  LATITUDE: number
  OBTADDRESS: string | null
  FIXHEIGHT: number
}

type RawRecord = Record<string, number | string>

// Source values are integers in tenths (wind m/s, °C, hPa, mm).
// Humidity and pressure report 0 when the station has no such sensor.
const tenth = (v: unknown) => (typeof v === "number" ? Math.round(v) / 10 : null)
const tenthNonZero = (v: unknown) => (typeof v === "number" && v !== 0 ? Math.round(v) / 10 : null)
const temp = (v: unknown) => (typeof v === "number" && v !== 0 && Math.abs(v) < 900 ? v / 10 : null)
const pct = (v: unknown) => (typeof v === "number" && v > 0 && v <= 100 ? v : null)
const dir = (v: unknown) => (typeof v === "number" && v >= 0 && v <= 360 ? v : null)

function normalise(r: RawRecord) {
  return {
    time: parseSourceDate(String(r.DDATETIME)),
    wind2: { speed: tenth(r.WD2DF), dir: dir(r.WD2DD) },
    wind10: { speed: tenth(r.WD10DF), dir: dir(r.WD10DD) },
    gust: { speed: tenth(r.WD3SMAXDF), dir: dir(r.WD3SMAXDD) },
    max10: { speed: tenth(r.WD10MAXDF), dir: dir(r.WD10MAXDD) },
    temp: temp(r.T),
    tempMax: temp(r.MAXT),
    tempMin: temp(r.MINT),
    humidity: pct(r.U),
    humidityMin: pct(r.MINU),
    pressure: tenthNonZero(r.P),
    rain: {
      h1: tenth(r.R01H),
      h3: tenth(r.R03H),
      h6: tenth(r.R06H),
      h12: tenth(r.R12H),
      h24: tenth(r.R24H),
      h72: tenth(r.R72H),
      hour: tenth(r.HOURR),
    },
  }
}

export default async (_req: Request, context: Context) => {
  const id = context.params.id ?? ""
  if (!/^[A-Za-z0-9]{3,10}$/.test(id)) return Response.json({ error: "Invalid station id" }, { status: 400 })

  try {
    const data = await callSource<{ INFO: RawInfo; HISTORY: RawRecord[] } | null>("GetOBTWindStatus", {
      strOBTID: id,
      currentTime: beijingNowString(),
    })
    if (!data?.INFO) return Response.json({ error: "Station not found" }, { status: 404 })

    const history = (data.HISTORY ?? []).map(normalise)
    return cachedJson(
      {
        id: data.INFO.OBTID,
        name: data.INFO.OBTNAME?.trim(),
        address: data.INFO.OBTADDRESS?.trim() || null,
        lat: data.INFO.LATITUDE,
        lon: data.INFO.LONGITUDE,
        elevation: data.INFO.FIXHEIGHT || null,
        latest: history.length ? history[history.length - 1] : null,
        history,
      },
      180,
    )
  } catch (err) {
    console.error("station fetch failed", id, err)
    return Response.json({ error: "The observation source is temporarily unavailable." }, { status: 502 })
  }
}

export const config: Config = {
  path: "/api/station/:id",
}
