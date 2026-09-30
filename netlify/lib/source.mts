// Shared helpers for talking to the Guangdong observation service that powers
// http://218.17.86.92/city/jieyang/ (an ASP.NET .asmx JSON API).

export const SOURCE_BASE = "http://218.17.86.92/backService/api.asmx"

// Geographic box requested from the source. Covers Guangdong plus its
// offshore/island stations with a small margin.
export const BOUNDS = { south: 18, west: 108.5, north: 26.5, east: 118 }

export async function callSource<T>(method: string, body: unknown, timeoutMs = 20000): Promise<T> {
  const res = await fetch(`${SOURCE_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Source ${method} responded ${res.status}`)
  const json = (await res.json()) as { d: T }
  return json.d
}

// The source encodes Beijing wall-clock time as "/Date(ms)/" without a zone,
// so the number is 8 hours ahead of the true UTC instant.
const BEIJING_OFFSET_MS = 8 * 3600_000

export function parseSourceDate(value: string): string | null {
  const m = /-?\d+/.exec(value ?? "")
  return m ? new Date(Number(m[0]) - BEIJING_OFFSET_MS).toISOString() : null
}

export function beijingNowString(): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 19)
}

export function cachedJson(data: unknown, cdnSeconds: number): Response {
  return Response.json(data, {
    headers: {
      "Cache-Control": "public, max-age=30",
      "Netlify-CDN-Cache-Control": `public, durable, max-age=${cdnSeconds}, stale-while-revalidate=${cdnSeconds * 2}`,
    },
  })
}
