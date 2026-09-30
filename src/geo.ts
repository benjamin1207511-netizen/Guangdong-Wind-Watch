// Point-in-polygon lookup against the bundled Guangdong prefecture boundaries.

type Ring = [number, number][]
interface City {
  name: string
  bbox: [number, number, number, number] // minLon, minLat, maxLon, maxLat
  polygons: Ring[][]
}

export interface CityIndex {
  names: string[]
  locate: (lat: number, lon: number) => string | null
  bounds: (name: string) => [[number, number], [number, number]] | null
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function buildCityIndex(geojson: GeoJSON.FeatureCollection): CityIndex {
  const cities: City[] = geojson.features.map((f) => {
    const g = f.geometry as GeoJSON.MultiPolygon | GeoJSON.Polygon
    const polygons = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as Ring[][]
    let minX = 180, minY = 90, maxX = -180, maxY = -90
    for (const poly of polygons)
      for (const [x, y] of poly[0]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    return { name: String(f.properties?.name), bbox: [minX, minY, maxX, maxY], polygons }
  })

  return {
    names: cities.map((c) => c.name),
    locate(lat, lon) {
      for (const c of cities) {
        const [a, b, cx, d] = c.bbox
        if (lon < a || lon > cx || lat < b || lat > d) continue
        for (const poly of c.polygons) {
          if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lon, lat, hole))) return c.name
        }
      }
      return null
    },
    bounds(name) {
      const c = cities.find((x) => x.name === name)
      return c ? [[c.bbox[1], c.bbox[0]], [c.bbox[3], c.bbox[2]]] : null
    },
  }
}
