// Kartverket place names (Geonorge "stedsnavn" API v1), fetched directly from the
// browser — the API allows cross-origin requests and needs no key.
// https://ws.geonorge.no/stedsnavn/v1/

export interface PlaceHit {
  /** display name as written */
  name: string;
  /** e.g. "Fjelltopp", "By", "Innsjø" */
  kind: string;
  /** municipality name(s), joined */
  municipality: string;
  county: string;
  lat: number;
  lon: number;
  /** Kartverket's stable id when present */
  id: string;
}

const ENDPOINT = "https://ws.geonorge.no/stedsnavn/v1/navn";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function names(list: unknown, key: string): string {
  if (!Array.isArray(list)) return "";
  return list
    .map((item) => (isRecord(item) ? str(item[key]) : ""))
    .filter(Boolean)
    .join(", ");
}

/** Parse the API response defensively; unknown shapes yield no hits rather than an exception. */
export function parseStedsnavn(json: unknown): PlaceHit[] {
  if (!isRecord(json) || !Array.isArray(json["navn"])) return [];
  const hits: PlaceHit[] = [];
  for (const raw of json["navn"]) {
    if (!isRecord(raw)) continue;
    const point = raw["representasjonspunkt"];
    if (!isRecord(point)) continue;
    const lon = point["øst"];
    const lat = point["nord"];
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    const name = str(raw["skrivemåte"]);
    if (!name) continue;
    hits.push({
      name,
      kind: str(raw["navneobjekttype"]),
      municipality: names(raw["kommuner"], "kommunenavn"),
      county: names(raw["fylker"], "fylkesnavn"),
      lat,
      lon,
      id: raw["stedsnummer"] === undefined ? "" : String(raw["stedsnummer"]),
    });
  }
  return hits;
}

/** Query URL for a free-text search (prefix match; up to `limit` hits). */
export function stedsnavnUrl(query: string, limit = 8): string {
  const q = query.trim();
  const params = new URLSearchParams({
    sok: q.endsWith("*") ? q : `${q}*`,
    utkoordsys: "4258",
    treffPerSide: String(limit),
    side: "1",
  });
  return `${ENDPOINT}?${params.toString()}`;
}

/** Search place names. Throws on network/HTTP errors; the caller decides how to show them. */
export async function searchPlaces(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<PlaceHit[]> {
  if (query.trim().length < 2) return [];
  const init: RequestInit = { headers: { Accept: "application/json" } };
  if (options.signal) init.signal = options.signal;
  const response = await fetch(stedsnavnUrl(query, options.limit ?? 8), init);
  if (!response.ok) throw new Error(`stedsnavn ${response.status}`);
  return parseStedsnavn((await response.json()) as unknown);
}
