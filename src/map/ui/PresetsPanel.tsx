import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  currentViewSettings,
  useMapStore,
  type MapMode,
  type ViewPreset,
} from "@/map/store/mapStore";

import { GlassPanel } from "./GlassPanel";

interface PresetsPanelProps {
  className?: string | undefined;
}

const MODE_KEY: Record<MapMode, string> = {
  bent: "view.bent",
  classic3d: "view.classic3d",
  "2d": "view.flat",
};

function presetMatches(preset: ViewPreset, mode: MapMode, settingsJson: string): boolean {
  return preset.mode === mode && JSON.stringify(preset.settings) === settingsJson;
}

/** Save the current view (mode + all settings) under a name; apply or delete saved views. */
export function PresetsPanel({ className }: PresetsPanelProps) {
  const { t } = useTranslation();
  const presets = useMapStore((s) => s.presets);
  const mode = useMapStore((s) => s.mode);
  const settingsJson = useMapStore((s) => JSON.stringify(currentViewSettings(s)));
  const savePreset = useMapStore((s) => s.savePreset);
  const applyPreset = useMapStore((s) => s.applyPreset);
  const deletePreset = useMapStore((s) => s.deletePreset);
  const resetViewSettings = useMapStore((s) => s.resetViewSettings);
  const [name, setName] = useState("");

  const trimmed = name.trim();
  const replaces = presets.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());

  const save = () => {
    if (!trimmed) return;
    if (savePreset(trimmed)) setName("");
  };

  return (
    <GlassPanel padding="sm" className={className}>
      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {t("presets.title")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={resetViewSettings}
          >
            {t("presets.reset")}
          </Button>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("presets.namePlaceholder")}
            maxLength={60}
            className="h-8 text-xs"
            aria-label={t("presets.namePlaceholder")}
            data-testid="preset-name"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="h-8 shrink-0"
            disabled={!trimmed}
            data-testid="preset-save"
          >
            {replaces ? t("presets.update") : t("presets.save")}
          </Button>
        </form>

        {presets.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t("presets.empty")}</p>
        ) : (
          <ul className="grid gap-1" data-testid="preset-list">
            {presets.map((preset) => {
              const active = presetMatches(preset, mode, settingsJson);
              return (
                <li key={preset.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    aria-label={t("presets.apply", { name: preset.name })}
                    aria-pressed={active}
                    className={
                      "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/10 " +
                      (active ? "bg-accent/15 text-accent" : "text-foreground")
                    }
                  >
                    <span className="truncate">{preset.name}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t(MODE_KEY[preset.mode])}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(preset.id)}
                    aria-label={t("presets.delete", { name: preset.name })}
                    className="h-7 w-7 shrink-0 rounded-md text-sm text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GlassPanel>
  );
}
