import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { searchPlaces, type PlaceHit } from "@/map/data/stedsnavn";
import { useMapStore } from "@/map/store/mapStore";

import { GlassPanel } from "./GlassPanel";

interface PlaceSearchProps {
  className?: string | undefined;
}

const DEBOUNCE_MS = 250;

/** Search Kartverket place names and fly to the chosen one. */
export function PlaceSearch({ className }: PlaceSearchProps) {
  const { t } = useTranslation();
  const flyTo = useMapStore((s) => s.flyTo);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">("idle");
  const [active, setActive] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    abort.current?.abort();
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setStatus("loading");
    const timer = setTimeout(() => {
      searchPlaces(q, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setHits(result);
          setActive(0);
          setStatus(result.length === 0 ? "empty" : "idle");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn("[stedsnavn]", error instanceof Error ? error.message : error);
          setHits([]);
          setStatus("error");
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const go = (hit: PlaceHit) => {
    flyTo({ lat: hit.lat, lon: hit.lon });
    setQuery("");
    setHits([]);
    setStatus("idle");
  };

  return (
    <GlassPanel padding="sm" className={className}>
      <div className="grid gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (event.key === "Enter") {
              const hit = hits[active];
              if (hit) go(hit);
            } else if (event.key === "Escape") {
              setQuery("");
            }
          }}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          className="h-8 text-xs"
          autoComplete="off"
          data-testid="place-search"
        />
        {status === "loading" && (
          <p className="text-[11px] text-muted-foreground">{t("search.loading")}</p>
        )}
        {status === "empty" && (
          <p className="text-[11px] text-muted-foreground">{t("search.empty")}</p>
        )}
        {status === "error" && <p className="text-[11px] text-destructive">{t("search.error")}</p>}
        {hits.length > 0 && (
          <ul className="grid gap-0.5" role="listbox" data-testid="place-results">
            {hits.map((hit, index) => (
              <li key={`${hit.id}-${hit.name}-${index}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(hit)}
                  className={
                    "flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-foreground/10 " +
                    (index === active ? "bg-accent/15 text-accent" : "text-foreground")
                  }
                >
                  <span className="truncate">{hit.name}</span>
                  <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                    {[hit.kind, hit.municipality].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassPanel>
  );
}
