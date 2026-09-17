import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";



export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Himinrond — 3D-kart over Norge" },
      {
        name: "description",
        content:
          "Himinrond er et 3D-kart over Norge med Bent World-visning: kartet bøyer seg opp i en ekte horisont.",
      },
      { property: "og:title", content: "Himinrond — 3D-kart over Norge" },
      {
        property: "og:description",
        content:
          "Himinrond er et 3D-kart over Norge med Bent World-visning: kartet bøyer seg opp i en ekte horisont.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background">
      <h1 className="font-serif text-[72px] italic leading-none text-foreground">Himinrond</h1>
      <p className="mt-4 font-sans text-base text-muted-foreground">{t("tagline")}</p>
    </main>
  );
}
