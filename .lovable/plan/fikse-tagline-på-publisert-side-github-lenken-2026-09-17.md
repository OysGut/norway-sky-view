# Fikse tagline på publisert side + GitHub-lenken

## Hva jeg fant

**1. Taglinen mangler på den publiserte siden**
Den publiserte siden er faktisk oppdatert (tittel, beskrivelse og "Himinrond" er riktige). Men der taglinen skal stå, står ordet `tagline` — altså selve nøkkelen i stedet for teksten "himmelens rand".

Årsaken: på Lovable blir siden ferdigbygget på serveren før den sendes til nettleseren. Språkoppsettet vårt rekker ikke å bli klart før siden bygges, så teksten faller tilbake til nøkkelnavnet. I forhåndsvisningen skjer alt i nettleseren, derfor ser det riktig ut der.

**2. github.com/OysGut/norway-sky-view gir 404**
Den adressen finnes ikke offentlig. Prosjektet er ikke koblet til GitHub ennå — koden ligger bare i Lovable. Publisering til Lovable sender ingenting til GitHub; det er en egen kobling du må opprette selv.

## Hva jeg gjør

- Gjøre språkoppsettet ferdig med én gang (synkront), slik at teksten finnes allerede når serveren bygger siden.
- Laste språkoppsettet ett sted sentralt, så alle sider får det, ikke bare forsiden.
- Verifisere at "himmelens rand" faktisk står i sidens kildekode på serveren, ikke bare etter at nettleseren har lastet.
- Publisere på nytt og sjekke den ekte adressen https://himinrond.lovable.app.

GitHub-koblingen kan jeg ikke opprette for deg — den må du gjøre selv: pluss-menyen (+) nederst til venstre i chatten → GitHub → Connect project. Da opprettes repoet, og koden synkroniseres begge veier etterpå. Si fra når det er gjort, så bekrefter jeg at alt ligger der.

## Teknisk

- `src/i18n/index.ts`: legg til `initImmediate: false` og `react: { useSuspense: false }` i `i18n.init(...)` slik at ressursene er tilgjengelige synkront under SSR.
- `src/routes/__root.tsx`: importer `@/i18n` der (side-effect), og fjern den lokale importen i `src/routes/index.tsx`.
- Verifisering: `curl` mot den publiserte siden og sjekk at `himmelens rand` finnes i SSR-HTML-en.

## Filer som endres

- `src/i18n/index.ts`
- `src/routes/__root.tsx`
- `src/routes/index.tsx`
