// Beaufort scale helpers and wind-barb geometry shared by the map canvas
// and the SVG charts in the station drawer.

export const BEAUFORT_MIN_MS = [0, 0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37.0, 41.5, 46.2, 51.0, 56.1, 61.3]

export const BEAUFORT_NAMES = [
  "Calm", "Light air", "Light breeze", "Gentle breeze", "Moderate breeze", "Fresh breeze",
  "Strong breeze", "Near gale", "Gale", "Strong gale", "Storm", "Violent storm", "Hurricane force",
]

export interface ForceBand {
  label: string
  min: number
  max: number
  color: string
}

// Colour bands follow the operational groupings used by Guangdong typhoon
// services (≤3, 4–5, 6–7, 8–9, 10–11, ≥12), tuned for a dark basemap.
export const BANDS: ForceBand[] = [
  { label: "0–3", min: 0, max: 3, color: "#9fb1c4" },
  { label: "4–5", min: 4, max: 5, color: "#45d0c0" },
  { label: "6–7", min: 6, max: 7, color: "#f4d35e" },
  { label: "8–9", min: 8, max: 9, color: "#f79a3e" },
  { label: "10–11", min: 10, max: 11, color: "#ef4a4a" },
  { label: "12+", min: 12, max: 99, color: "#e0479e" },
]

export function bandFor(force: number): ForceBand {
  return BANDS.find((b) => force >= b.min && force <= b.max) ?? BANDS[BANDS.length - 1]
}

export function forceColor(force: number): string {
  return bandFor(force).color
}

export function msToForce(ms: number): number {
  let f = 0
  for (let i = 0; i < BEAUFORT_MIN_MS.length; i++) if (ms >= BEAUFORT_MIN_MS[i]) f = i
  return f
}

// Representative speed (middle of the Beaufort range) used to draw a barb
// when the source only provides a force level.
export function forceToMs(force: number): number {
  if (force <= 0) return 0
  const lo = BEAUFORT_MIN_MS[Math.min(force, BEAUFORT_MIN_MS.length - 1)]
  const hi = BEAUFORT_MIN_MS[force + 1] ?? lo + 5
  return (lo + hi) / 2
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
export function compass(deg: number | null | undefined): string {
  if (deg == null) return "—"
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}

export interface BarbShape {
  staff: string // stroked
  pennants: string // filled
  calm: boolean
}

// Chinese Meteorological Administration convention for station plots:
// half barb = 2 m/s, full barb = 4 m/s, pennant = 20 m/s.
// Geometry is for a wind FROM north (staff pointing up from the station at
// the origin, feathers on the right). Rotate by the wind direction to place it.
export function barbShape(speedMs: number, length = 22, feather = 9): BarbShape {
  const units = Math.round(speedMs / 2) // number of 2 m/s steps
  if (speedMs < 1 || units === 0) {
    if (speedMs < 0.3) return { staff: "", pennants: "", calm: true }
    return { staff: `M0 0L0 ${-length}`, pennants: "", calm: false }
  }
  let rest = units
  const pennantCount = Math.floor(rest / 10)
  rest -= pennantCount * 10
  const fullCount = Math.floor(rest / 2)
  const half = rest % 2 === 1

  const gap = feather * 0.42
  const slant = feather * 0.45
  let y = -length
  let staff = `M0 0L0 ${-length}`
  let pennants = ""

  for (let i = 0; i < pennantCount; i++) {
    const pw = feather * 0.5
    pennants += `M0 ${y}L${feather} ${y - slant * 0.2}L0 ${y + pw}Z`
    y += pw + 1
  }
  if (pennantCount > 0) y += 1
  for (let i = 0; i < fullCount; i++) {
    staff += `M0 ${y}L${feather} ${y - slant}`
    y += gap
  }
  if (half) {
    // A lone half barb sits one step in from the tip so it is not mistaken for a full one.
    if (pennantCount === 0 && fullCount === 0) y += gap
    staff += `M0 ${y}L${feather * 0.55} ${y - slant * 0.55}`
  }
  return { staff, pennants, calm: false }
}
