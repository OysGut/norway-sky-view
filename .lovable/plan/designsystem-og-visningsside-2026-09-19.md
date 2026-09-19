# Designsystem og visningsside

## Mål
Fullføre designgrunnlaget og lage en egen `/design`-side som viser farger, typografi, glassflater, kontroller, statuser og ikoner i både mørkt og lyst tema.

## Gjennomføring
- Legge til de tre spesifiserte pakkene på riktig plass og registrere `test`-kommandoen.
- Lage temastyring med mørkt standardtema, lagring i nettleseren og et lite før-visning-skript som hindrer feil temaglimt.
- Legge til felles bevegelsesvariabler og støtte for redusert bevegelse.
- Lage de gjenbrukbare byggeklossene `GlassPanel`, `Readout` og `ThemeToggle`.
- Utvide bokmål og engelsk med alle tekster som brukes på designsiden.
- Lage `/design` med de avtalte seksjonene, eksisterende kontrollkomponenter og unik metadata.
- Kontrollere tester, typesjekk, bygg og siden i begge temaer uten konsollfeil.

## Tekniske detaljer
- Eksisterende Tailwind v4-tokens beholdes; bare bevegelsesvariablene legges til.
- All nettlesertilgang skjermes fra serverkjøring.
- Ingen filer i kartmotoren eller forsiden endres.
- Ingen database-, 3D- eller backendarbeid inngår.
