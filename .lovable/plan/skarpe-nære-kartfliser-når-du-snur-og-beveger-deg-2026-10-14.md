# Skarpe nære kartfliser når du snur og beveger deg

## Mål
Detaljerte fliser nær deg skal ikke byttes ut med grove når du snur litt på kartet eller går et lite stykke frem. Horisonten og resten av motoren skal fortsette som i dag.

## Mistenkt årsak (bekreftes først)
- Når du snur, flyttes brukerpunktet rundt et punkt midt på skjermen, som kan ligge flere km foran deg. Selv en kort snuing kan derfor se ut som at du "flyr" med flere km/s.
- Terrenglaget måler farten ut fra hvor mye brukerpunktet flytter seg. Over 2 km/s kaster det de to fineste ringene, fordi det tror du flyr. Da forsvinner de skarpe flisene nær deg, og de grove vises i stedet.
- Når du går frem, flytter ringene seg. Fliser hvis "hull" eller kant endrer seg, må lages på nytt. Det skal allerede skje uten at det blir tomt, men dette må måles.

## Steg
1. **Måle før vi endrer noe.** Kjør en kort automatisk test på testsiden: snu 45–90° og gå 1–2 km frem. Logg målt fart, hvilke ringer som er aktive og hvilke fliser som vises eller skjules. Bare om målingen bekrefter årsaken, går vi videre til steg 2–4. Viser den noe annet, rapporterer jeg det før jeg endrer noe.
2. **Snuing er ikke flyging.** Flytting av brukerpunktet som kommer fra snuing, skal ikke telle med i farten.
3. **Ro før grov modus.** Fine ringer kastes først når farten har ligget høyt over tid, cirka et halvt sekund. De kommer tilbake først når farten har vært lav en stund. Dette hindrer frem-og-tilbake-bytting.
4. **Aldri vise grovt over skarpt.** Ferdige fine fliser som fortsatt er på skjermen, blir stående til den nye flisen for samme område er klar. Det samme prinsippet gjelder allerede ved flytting.

## Ikke med
- Ingen endring i motoren: bøyingen, horisonten, ringstørrelser og nedlasting.
- Ingen Voxel Space-teknikk.

## Tekniske detaljer
- Endringer kun i `src/map/layers/TerrainLayer.tsx`, og en liten markør i mapStore eller fra `rotation.ts`/navigasjonen for at "denne flyttingen er snuing". Ingen filer under `src/map/engine/` endres; `ringsForSpeed` brukes som før, men får en utjevnet og filtrert fart.
- Hysterese: grov modus på når farten har vært over terskelen i mer enn 0,5 s, av når den har vært under terskelen × 0,5 i mer enn 1 s.
- Tester: ren funksjon for fartsfilter og hysterese med vitest (snuing gir 0 fart; kort topp utløser ikke grov modus; vedvarende fart gjør det).
- Verifisering: samme Playwright-måling som i steg 1, før og etter, med skjermbilder.
