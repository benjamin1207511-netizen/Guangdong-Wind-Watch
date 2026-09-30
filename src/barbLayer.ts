import L from "leaflet"
import { barbShape, forceColor, forceToMs } from "./wind"

export interface Station {
  id: string
  lat: number
  lon: number
  force: number
  dir: number
  city: string | null
  name?: string
  /** Offshore station that the source leaves off its own barb layer. */
  offshore?: boolean
}

interface Placed {
  s: Station
  x: number
  y: number
}

// Draws wind barbs for thousands of stations onto a single canvas that sits
// above the map tiles. Barbs are thinned on a screen-space grid, keeping the
// strongest wind in each cell, so the map stays readable at every zoom.
export class BarbLayer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private stations: Station[] = []
  private placed: Placed[] = []
  private shapeCache = new Map<number, { staff: Path2D; pennants: Path2D; calm: boolean }>()
  private frame = 0
  spacing = 26
  showAll = false

  constructor(private map: L.Map) {
    this.canvas = document.createElement("canvas")
    this.canvas.className = "barb-canvas"
    map.getContainer().appendChild(this.canvas)
    this.ctx = this.canvas.getContext("2d")!
    map.on("move resize", () => this.schedule())
    map.on("zoomstart", () => this.canvas.classList.add("is-zooming"))
    map.on("zoomend", () => {
      this.canvas.classList.remove("is-zooming")
      this.schedule()
    })
  }

  setStations(stations: Station[]) {
    // Offshore stations first (they are sparse and easy to lose), then
    // strongest first so they win their grid cell.
    this.stations = [...stations].sort(
      (a, b) => Number(!!b.offshore) - Number(!!a.offshore) || b.force - a.force,
    )
    this.schedule()
  }

  schedule() {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.draw())
  }

  /** Nearest drawn station within `radius` pixels of a container point. */
  hitTest(point: L.Point, radius = 14): Station | null {
    let best: Placed | null = null
    let bestD = radius * radius
    for (const p of this.placed) {
      const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2
      if (d < bestD) { bestD = d; best = p }
    }
    return best?.s ?? null
  }

  private shape(force: number, scale: number) {
    const key = force * 100 + Math.round(scale * 10)
    let s = this.shapeCache.get(key)
    if (!s) {
      const b = barbShape(forceToMs(force), 22 * scale, 9 * scale)
      s = { staff: new Path2D(b.staff), pennants: new Path2D(b.pennants), calm: b.calm }
      this.shapeCache.set(key, s)
    }
    return s
  }

  private draw() {
    const size = this.map.getSize()
    const dpr = window.devicePixelRatio || 1
    if (this.canvas.width !== size.x * dpr || this.canvas.height !== size.y * dpr) {
      this.canvas.width = size.x * dpr
      this.canvas.height = size.y * dpr
      this.canvas.style.width = `${size.x}px`
      this.canvas.style.height = `${size.y}px`
    }
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)

    const zoom = this.map.getZoom()
    const scale = Math.min(1.25, Math.max(0.8, 0.55 + zoom * 0.07))
    const cell = this.showAll ? 0 : this.spacing * scale
    const occupied = new Set<string>()
    const placed: Placed[] = []
    const pad = 30

    for (const s of this.stations) {
      const pt = this.map.latLngToContainerPoint([s.lat, s.lon])
      if (pt.x < -pad || pt.y < -pad || pt.x > size.x + pad || pt.y > size.y + pad) continue
      if (cell > 0) {
        const key = `${Math.floor(pt.x / cell)},${Math.floor(pt.y / cell)}`
        if (occupied.has(key)) continue
        occupied.add(key)
      }
      placed.push({ s, x: pt.x, y: pt.y })
    }
    this.placed = placed

    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    // Two passes: a dark halo for contrast over any tile, then the coloured barb.
    for (const pass of [0, 1] as const) {
      for (const p of placed) {
        const shape = this.shape(p.s.force, scale)
        const color = forceColor(p.s.force)
        ctx.setTransform(dpr, 0, 0, dpr, p.x * dpr, p.y * dpr)
        if (shape.calm) {
          ctx.beginPath()
          ctx.arc(0, 0, 3.2 * scale, 0, Math.PI * 2)
          ctx.lineWidth = pass === 0 ? 3.4 : 1.3
          ctx.strokeStyle = pass === 0 ? "rgba(6,12,20,0.75)" : color
          ctx.stroke()
          continue
        }
        ctx.rotate((p.s.dir * Math.PI) / 180)
        if (pass === 0) {
          ctx.lineWidth = 3.6
          ctx.strokeStyle = "rgba(6,12,20,0.75)"
          ctx.stroke(shape.staff)
          ctx.stroke(shape.pennants)
        } else {
          ctx.lineWidth = 1.35
          ctx.strokeStyle = color
          ctx.fillStyle = color
          ctx.stroke(shape.staff)
          ctx.fill(shape.pennants)
          ctx.beginPath()
          ctx.arc(0, 0, 1.6, 0, Math.PI * 2)
          ctx.fill()
        }
        if (p.s.offshore) {
          // Diamond at the station point marks offshore platforms and islands.
          const r = 4.2 * scale
          ctx.setTransform(dpr, 0, 0, dpr, p.x * dpr, p.y * dpr)
          ctx.beginPath()
          ctx.moveTo(0, -r)
          ctx.lineTo(r, 0)
          ctx.lineTo(0, r)
          ctx.lineTo(-r, 0)
          ctx.closePath()
          ctx.lineWidth = pass === 0 ? 3.4 : 1.3
          ctx.strokeStyle = pass === 0 ? "rgba(6,12,20,0.75)" : "#ffffff"
          ctx.stroke()
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.map.fire("barbs:drawn", { count: placed.length })
  }
}
