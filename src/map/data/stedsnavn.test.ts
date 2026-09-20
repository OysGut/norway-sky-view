import { describe, expect, it } from "vitest";

import { parseStedsnavn, stedsnavnUrl } from "./stedsnavn";

describe("stedsnavn", () => {
  it("builds a prefix query in EPSG:4258", () => {
    const url = new URL(stedsnavnUrl("Galdhø", 5));
    expect(url.origin + url.pathname).toBe("https://ws.geonorge.no/stedsnavn/v1/navn");
    expect(url.searchParams.get("sok")).toBe("Galdhø*");
    expect(url.searchParams.get("utkoordsys")).toBe("4258");
    expect(url.searchParams.get("treffPerSide")).toBe("5");
    expect(new URL(stedsnavnUrl("Oslo*")).searchParams.get("sok")).toBe("Oslo*");
  });

  it("parses hits defensively", () => {
    const hits = parseStedsnavn({
      navn: [
        {
          skrivemåte: "Galdhøpiggen",
          navneobjekttype: "Fjelltopp",
          stedsnummer: 123,
          representasjonspunkt: { øst: 8.3125, nord: 61.6364, koordsys: 4258 },
          kommuner: [{ kommunenavn: "Lom" }],
          fylker: [{ fylkesnavn: "Innlandet" }],
        },
        { skrivemåte: "Uten punkt" },
        "junk",
        { representasjonspunkt: { øst: "8", nord: 61 }, skrivemåte: "Feil type" },
      ],
    });
    expect(hits).toEqual([
      {
        name: "Galdhøpiggen",
        kind: "Fjelltopp",
        municipality: "Lom",
        county: "Innlandet",
        lat: 61.6364,
        lon: 8.3125,
        id: "123",
      },
    ]);
    expect(parseStedsnavn(null)).toEqual([]);
    expect(parseStedsnavn({ navn: "nope" })).toEqual([]);
  });
});
