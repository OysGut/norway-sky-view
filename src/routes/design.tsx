import { createFileRoute } from "@tanstack/react-router";
import {
  IconAnchor,
  IconCloud,
  IconCompass,
  IconMountain,
  IconSailboat,
  IconSunrise,
} from "@tabler/icons-react";
import { ChevronDown, Layers, Search, Settings, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { GlassPanel } from "@/map/ui/GlassPanel";
import { Readout } from "@/map/ui/Readout";
import { ThemeToggle } from "@/map/ui/ThemeToggle";

export const Route = createFileRoute("/design")({
  head: () => ({
    meta: [
      { title: "Designsystem — Himinrond" },
      {
        name: "description",
        content: "Farger, typografi, glassflater, kontroller og ikoner for Himinrond.",
      },
      { property: "og:title", content: "Designsystem — Himinrond" },
      {
        property: "og:description",
        content: "Farger, typografi, glassflater, kontroller og ikoner for Himinrond.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DesignPage,
});

const swatches = [
  { key: "background", token: "background", value: "#0A0E17", className: "bg-background" },
  { key: "foreground", token: "foreground", value: "#EDF1F7", className: "bg-foreground" },
  {
    key: "mutedForeground",
    token: "muted-foreground",
    value: "#93A1B5",
    className: "bg-muted-foreground",
  },
  { key: "card", token: "card", value: "#151A26", className: "bg-card" },
  { key: "accent", token: "accent", value: "#3FE8B0", className: "bg-accent" },
  { key: "accent2", token: "accent-2", value: "#A78BFA", className: "bg-accent-2" },
  { key: "success", token: "success", value: "#5FD16E", className: "bg-success" },
  { key: "warning", token: "warning", value: "#F5B942", className: "bg-warning" },
  { key: "danger", token: "danger", value: "#F0555A", className: "bg-danger" },
  { key: "info", token: "info", value: "#55B7E7", className: "bg-info" },
  { key: "border", token: "border", value: "#FFFFFF / 10%", className: "bg-border" },
  { key: "glass", token: "glass", value: "#171D29 / 55%", className: "bg-glass" },
] as const;

const domainIcons = [IconMountain, IconAnchor, IconCompass, IconCloud, IconSailboat, IconSunrise];
const chromeIcons = [Search, Layers, X, ChevronDown, Settings];

const motionClass = "transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)]";

function SectionHeading({ children }: { children: string }) {
  return <h2 className="mb-6 text-2xl font-medium text-foreground">{children}</h2>;
}

function DesignPage() {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-background px-8 py-14 text-foreground transition-colors duration-[var(--motion-duration)] ease-[var(--motion-ease)] lg:px-16">
      <ThemeToggle className="fixed right-6 top-6 z-50" />

      <header className="mx-auto mb-16 max-w-7xl border-b border-border pb-10">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">{t("design.intro")}</p>
        <h1 className="mt-3 text-5xl font-medium text-foreground">{t("design.title")}</h1>
      </header>

      <div className="mx-auto max-w-7xl space-y-20">
        <section>
          <SectionHeading>{t("design.sections.colours")}</SectionHeading>
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {swatches.map((swatch) => (
              <div key={swatch.token} className="min-w-0">
                <div className={`h-24 rounded-md border border-border ${swatch.className} ${motionClass}`} />
                <p className="mt-3 text-sm font-medium text-foreground">
                  {t(`design.colours.${swatch.key}`)}
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">--{swatch.token}</p>
                <p className="tabular mt-1 text-xs text-muted-foreground">{swatch.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionHeading>{t("design.sections.type")}</SectionHeading>
          <div className="grid gap-12 lg:grid-cols-[1.25fr_1fr]">
            <div>
              <p className="font-serif text-[72px] italic leading-none text-foreground">{t("appName")}</p>
              <div className="mt-12 space-y-5">
                <h1 className="text-4xl font-medium text-foreground">{t("design.type.h1")}</h1>
                <h2 className="text-3xl font-medium text-foreground">{t("design.type.h2")}</h2>
                <h3 className="text-xl font-medium text-foreground">{t("design.type.h3")}</h3>
                <p className="max-w-xl text-base leading-7 text-foreground">{t("design.type.body")}</p>
                <p className="text-sm text-muted-foreground">{t("design.type.small")}</p>
              </div>
            </div>
            <div className="grid content-start gap-8 border-l border-border pl-8">
              <Readout label={t("design.readouts.elevation")} value="2 469 m" size="lg" />
              <Readout label={t("design.readouts.latitude")} value="61,6364° N" size="md" />
              <Readout label={t("design.readouts.localTime")} value="14:32" size="sm" />
            </div>
          </div>
        </section>

        <section>
          <SectionHeading>{t("design.sections.glass")}</SectionHeading>
          <div
            className="relative flex min-h-96 items-center overflow-hidden rounded-md border border-border px-8 py-12"
            style={{ background: "linear-gradient(180deg, #0A0E17 0%, #1D3A5C 52%, #2A3A2E 100%)" }}
          >
            <div className="absolute left-[12%] top-[16%] h-36 w-64 rounded-full bg-info/20 blur-3xl" />
            <div className="absolute bottom-[8%] right-[15%] h-44 w-72 rounded-full bg-success/15 blur-3xl" />
            <GlassPanel className="relative z-10 max-w-md" padding="lg">
              <h3 className="text-xl font-medium text-foreground">{t("design.glass.title")}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("design.glass.description")}</p>
              <div className="mt-8">
                <Readout label={t("design.readouts.elevation")} value="2 469 m" size="lg" />
              </div>
            </GlassPanel>
          </div>
        </section>

        <section>
          <SectionHeading>{t("design.sections.controls")}</SectionHeading>
          <div className="flex flex-wrap gap-3">
            <Button className={motionClass}>{t("design.controls.default")}</Button>
            <Button variant="secondary" className={motionClass}>{t("design.controls.secondary")}</Button>
            <Button variant="ghost" className={motionClass}>{t("design.controls.ghost")}</Button>
            <Button variant="outline" className={motionClass}>{t("design.controls.outline")}</Button>
            <Button variant="destructive" className={motionClass}>{t("design.controls.destructive")}</Button>
          </div>
          <div className="mt-10 grid max-w-3xl gap-8 md:grid-cols-2">
            <label className="space-y-3 text-sm font-medium text-foreground">
              <span>{t("design.controls.range")}</span>
              <Slider className={motionClass} defaultValue={[62]} aria-label={t("design.controls.range")} />
            </label>
            <label className="flex items-center justify-between gap-5 text-sm font-medium text-foreground">
              <span>{t("design.controls.liveLayers")}</span>
              <Switch className={motionClass} defaultChecked aria-label={t("design.controls.liveLayers")} />
            </label>
          </div>
          <div className="mt-10 flex flex-wrap gap-3">
            <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">{t("design.controls.status.ok")}</span>
            <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-medium text-warning">{t("design.controls.status.warning")}</span>
            <span className="rounded-full bg-danger/15 px-3 py-1 text-xs font-medium text-danger">{t("design.controls.status.danger")}</span>
            <span className="rounded-full bg-info/15 px-3 py-1 text-xs font-medium text-info">{t("design.controls.status.info")}</span>
          </div>
        </section>

        <section className="pb-10">
          <SectionHeading>{t("design.sections.icons")}</SectionHeading>
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("design.icons.domain")}</p>
              <div className="flex flex-wrap gap-6 text-foreground">
                {domainIcons.map((Icon, index) => <Icon key={index} aria-hidden="true" size={20} stroke={1.5} />)}
              </div>
            </div>
            <div>
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("design.icons.chrome")}</p>
              <div className="flex flex-wrap gap-6 text-foreground">
                {chromeIcons.map((Icon, index) => <Icon key={index} aria-hidden="true" size={20} strokeWidth={1.5} />)}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}