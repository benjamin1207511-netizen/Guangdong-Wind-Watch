import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "./style.css"
import { fetchStation, fetchWind } from "./api"
import { BarbLayer, type Station } from "./barbLayer"
import { formatBjt, StationDrawer } from "./detail"
import { buildCityIndex, type CityIndex } from "./geo"
import { BEAUFORT_NAMES, barbShape, compass, forceColor, forceToMs } from "./wind"

const REFRESH_MS = 5 * 60_000
const OFFSHORE = "Offshore & border"
const GD_BOUNDS: L.LatLngBoundsExpression = [[20.1, 109.6], [25.6, 117.4]]

type Field = "mean" | "gust"

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const state = {
  field: "mean" as Field,
  city: "",
  stations: [] as Station[],
  observedAt: null as string | null,
  lastLoad: 0,
  loading: false,
}

// ---------- Map ----------
const map = L.map("map", { zoomControl: false, minZoom: 5, maxZoom: 14, preferCanvas: true, attributionControl: true })
map.fitBounds(GD_BOUNDS, { paddingTopLeft: [window.innerWidth > 900 ? 360 : 0, 0] })
L.control.zoom({ position: "bottomright" }).addTo(map)
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd",
}).addTo(map)
map.createPane("labels").style.zIndex = "420"
map.getPane("labels")!.style.pointerEvents = "none"
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", {
  subdomains: "abcd",
  pane: "labels",
  opacity: 0.7,
}).addTo(map)

const barbs = new BarbLayer(map)
let borders: L.GeoJSON | null = null
let cities: CityIndex | null = null
let selectedMarker: L.CircleMarker | null = null

const drawer = new StationDrawer($("drawer"), () => {
  selectedMarker?.remove()
  selectedMarker = null
})

function selectStation(s: Pick<Station, "id" | "lat" | "lon">, fly = false) {
  selectedMarker?.remove()
  selectedMarker = L.circleMarker([s.lat, s.lon], { radius: 13, color: "#ffffff", weight: 2, fill: false, dashArray: "3 3" }).addTo(map)
  if (fly) map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 10), { duration: 0.8 })
  drawer.open(s.id)
}

// Hover tooltip and click selection come from the canvas hit test.
const tip = $("hoverTip")
map.on("mousemove", (e: L.LeafletMouseEvent) => {
  const s = barbs.hitTest(e.containerPoint)
  map.getContainer().style.cursor = s ? "pointer" : ""
  if (!s) return void (tip.hidden = true)
  tip.hidden = false
  tip.style.transform = `translate(${e.containerPoint.x + 14}px, ${e.containerPoint.y + 14}px)`
  const label = s.name ? `${s.name} <span class="muted">${s.id}</span>` : s.id
  tip.innerHTML = `<strong>${label}</strong>${s.city ? ` · ${s.city}` : s.offshore ? " · Offshore" : ""}<br/>Force ${s.force} · ${compass(s.dir)} ${Math.round(s.dir)}°`
})
map.on("mouseout", () => (tip.hidden = true))
map.on("click", (e: L.LeafletMouseEvent) => {
  const s = barbs.hitTest(e.containerPoint, 18)
  if (s) selectStation(s)
})

// ---------- Panel rendering ----------
function visibleStations() {
  return state.city ? state.stations.filter((s) => (s.city ?? OFFSHORE) === state.city) : state.stations
}

function renderLegend() {
  const samples = [0, 2, 3, 4, 5, 6, 8, 10]
  const items = samples
    .map((f) => {
      const shape = barbShape(forceToMs(f), 20, 8)
      const c = forceColor(f)
      const g = shape.calm
        ? `<circle cx="14" cy="14" r="3.5" stroke="${c}" fill="none" stroke-width="1.5"/>`
        : `<g transform="translate(14 14) rotate(270) translate(0 10)"><path d="${shape.staff}" stroke="${c}" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="${shape.pennants}" fill="${c}"/></g>`
      return `<div class="legend-item"><svg viewBox="0 0 28 28" width="28" height="28">${g}</svg><span>F${f}</span></div>`
    })
    .join("")
  const offshore = `<div class="legend-item"><svg viewBox="0 0 28 28" width="28" height="28"><path d="M14 9.5L18.5 14L14 18.5L9.5 14Z" stroke="#ffffff" stroke-width="1.3" fill="none"/></svg><span>Offshore</span></div>`
  $("legend").innerHTML = `<div class="legend-title">Beaufort force · barb points into the wind</div><div class="legend-row">${items}${offshore}</div>`
}

function renderHistogram(list: Station[]) {
  const counts = new Array(13).fill(0)
  for (const s of list) counts[Math.min(12, s.force)]++
  const maxForce = Math.max(4, ...list.map((s) => Math.min(12, s.force)))
  const peak = Math.max(1, ...counts)
  const rows = counts
    .slice(0, maxForce + 1)
    .map((c, f) => {
      const pct = (c / peak) * 100
      const share = list.length ? ((c / list.length) * 100).toFixed(c && c / list.length < 0.01 ? 1 : 0) : "0"
      return `<div class="hist-row" title="Force ${f} · ${BEAUFORT_NAMES[f]}: ${c} stations">
        <span class="hist-label">F${f}</span>
        <span class="hist-track"><span class="hist-bar" style="width:${pct}%;background:${forceColor(f)}"></span></span>
        <span class="hist-value">${c.toLocaleString()}<small>${share}%</small></span>
      </div>`
    })
    .join("")
  $("histogram").innerHTML = rows
}

function renderRose(list: Station[]) {
  const sectors = new Array(16).fill(0).map(() => ({ n: 0, force: 0 }))
  for (const s of list) {
    if (s.force === 0) continue
    const k = Math.round((((s.dir % 360) + 360) % 360) / 22.5) % 16
    sectors[k].n++
    sectors[k].force += s.force
  }
  const peak = Math.max(1, ...sectors.map((s) => s.n))
  const R = 70
  const cx = 90
  const cy = 90
  let petals = ""
  sectors.forEach((sec, i) => {
    if (!sec.n) return
    const r = 10 + (sec.n / peak) * (R - 10)
    const a0 = ((i * 22.5 - 10 - 90) * Math.PI) / 180
    const a1 = ((i * 22.5 + 10 - 90) * Math.PI) / 180
    const col = forceColor(Math.round(sec.force / sec.n))
    petals += `<path d="M${cx} ${cy}L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}A${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}Z" fill="${col}" fill-opacity="0.85"><title>From ${compass(i * 22.5)}: ${sec.n} stations</title></path>`
  })
  const rings = [0.33, 0.66, 1].map((f) => `<circle cx="${cx}" cy="${cy}" r="${10 + f * (R - 10)}" class="rose-ring"/>`).join("")
  const labels = ["N", "E", "S", "W"]
    .map((l, i) => {
      const a = ((i * 90 - 90) * Math.PI) / 180
      return `<text x="${cx + (R + 11) * Math.cos(a)}" y="${cy + (R + 11) * Math.sin(a) + 4}" text-anchor="middle">${l}</text>`
    })
    .join("")
  const dominant = sectors.reduce((best, s, i) => (s.n > sectors[best].n ? i : best), 0)
  $("compassRose").innerHTML = `<svg viewBox="0 0 180 180" class="rose">${rings}${petals}${labels}</svg>
    <div class="rose-caption"><div class="kpi-label">Direction distribution</div>
    <div>Prevailing wind from <strong>${compass(dominant * 22.5)}</strong></div>
    <div class="muted">${sectors[dominant].n.toLocaleString()} stations · petal colour = mean force</div></div>`
}

const nameCache = new Map<string, string>()
function renderTop(list: Station[]) {
  const top = [...list].sort((a, b) => b.force - a.force).slice(0, 8)
  for (const s of top) if (s.name) nameCache.set(s.id, s.name)
  const ol = $("topList")
  ol.innerHTML = top
    .map(
      (s) => `<li><button data-id="${s.id}">
        <span class="top-force" style="--c:${forceColor(s.force)}">F${s.force}</span>
        <span class="top-name"><span data-name="${s.id}">${nameCache.get(s.id) ?? s.id}</span><small>${s.city ?? OFFSHORE} · ${compass(s.dir)} ${Math.round(s.dir)}°</small></span>
      </button></li>`,
    )
    .join("")
  ol.querySelectorAll<HTMLButtonElement>("button[data-id]").forEach((btn) => {
    const s = top.find((t) => t.id === btn.dataset.id)!
    btn.onclick = () => selectStation(s, true)
  })
  // Station names are only available from the detail endpoint; fetch them lazily.
  for (const s of top) {
    if (nameCache.has(s.id)) continue
    fetchStation(s.id)
      .then((d) => {
        nameCache.set(s.id, d.name)
        const el = ol.querySelector(`[data-name="${s.id}"]`)
        if (el) el.textContent = d.name
      })
      .catch(() => {})
  }
}

function renderPanel() {
  const list = visibleStations()
  const max = list.reduce((m, s) => Math.max(m, s.force), 0)
  $("kpiCount").textContent = list.length.toLocaleString()
  $("kpiMax").innerHTML = list.length ? `<span style="color:${forceColor(max)}">F${max}</span>` : "—"
  $("kpiStrong").textContent = list.filter((s) => s.force >= 6).length.toLocaleString()
  renderHistogram(list)
  renderRose(list)
  renderTop(list)
  barbs.setStations(list)
}

// ---------- Data loading & auto-refresh ----------
function setStatus(kind: "ok" | "loading" | "error", text?: string) {
  $("statusDot").className = `dot ${kind}`
  if (text) $("observedAt").textContent = text
}

async function load() {
  if (state.loading || !cities) return
  state.loading = true
  setStatus("loading")
  try {
    const data = await fetchWind(state.field, (lat, lon) => cities!.locate(lat, lon))
    state.stations = data.stations
    state.observedAt = data.observedAt
    state.lastLoad = Date.now()
    setStatus("ok", `Observed ${formatBjt(data.observedAt ?? data.fetchedAt)}`)
    renderPanel()
    if (drawer.openId) drawer.refresh()
  } catch (err) {
    setStatus("error", (err as Error).message || "Could not load observations")
  } finally {
    state.loading = false
  }
}

function tickCountdown() {
  if (!state.lastLoad) return
  const left = Math.max(0, REFRESH_MS - (Date.now() - state.lastLoad))
  const m = Math.floor(left / 60_000)
  const s = Math.floor((left % 60_000) / 1000)
  $("nextRefresh").textContent = `Auto-refresh in ${m}:${String(s).padStart(2, "0")}`
  if (left === 0 && document.visibilityState === "visible") load()
}
setInterval(tickCountdown, 1000)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - state.lastLoad > REFRESH_MS) load()
})
$("refreshBtn").onclick = () => load()

// ---------- Controls ----------
document.querySelectorAll<HTMLButtonElement>("[data-field]").forEach((btn) => {
  btn.onclick = () => {
    const field = btn.dataset.field as Field
    if (field === state.field) return
    state.field = field
    document.querySelectorAll("[data-field]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)))
    load()
  }
})

$<HTMLSelectElement>("citySelect").onchange = (e) => {
  state.city = (e.target as HTMLSelectElement).value
  const b = state.city && state.city !== OFFSHORE ? cities?.bounds(state.city) : null
  map.flyToBounds(b ?? GD_BOUNDS, { duration: 0.8, paddingTopLeft: [window.innerWidth > 900 ? 360 : 0, 0] })
  borders?.setStyle((f) => borderStyle(f?.properties?.name))
  renderPanel()
}

$<HTMLInputElement>("density").oninput = (e) => {
  barbs.spacing = Number((e.target as HTMLInputElement).value)
  barbs.schedule()
}
$<HTMLInputElement>("showAll").onchange = (e) => {
  barbs.showAll = (e.target as HTMLInputElement).checked
  barbs.schedule()
}
$<HTMLInputElement>("showBorders").onchange = (e) => {
  if (!borders) return
  ;(e.target as HTMLInputElement).checked ? borders.addTo(map) : borders.remove()
}
$("panelToggle").onclick = () => $("panel").classList.toggle("collapsed")

function borderStyle(name?: string): L.PathOptions {
  const active = state.city && name === state.city
  return { color: active ? "#f4d35e" : "#6f8aa6", weight: active ? 2 : 0.8, opacity: active ? 0.9 : 0.55, fill: false, interactive: false }
}

// ---------- Boot ----------
async function boot() {
  renderLegend()
  const geo = (await fetch("/data/guangdong.json").then((r) => r.json())) as GeoJSON.FeatureCollection
  cities = buildCityIndex(geo)
  borders = L.geoJSON(geo, { style: (f) => borderStyle(f?.properties?.name) }).addTo(map)
  const select = $<HTMLSelectElement>("citySelect")
  for (const name of [...cities.names, OFFSHORE]) select.add(new Option(name, name))
  await load()
}
boot()
