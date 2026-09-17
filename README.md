# Norway Sky View

Context

This is the first message of a new project called Himinrond — a desktop-first 3D map of Norway with a signature "Bent World" view (map straight from above at the bottom of the screen, bending up into a real horizon with mountains, weather, stars and live data). Read the Project Knowledge carefully before doing anything: it defines the tech stack, folder structure, design tokens, data sources and always-on rules for this project.

Task

Set up the project skeleton. No 3D or map functionality yet — only structure, dependencies, design tokens and a minimal placeholder page.

Stack: React + Vite + TypeScript + Tailwind + shadcn/ui. Enable Lovable Cloud for this project (we will use Auth, Database, Storage, Edge Functions and Realtime later; nothing to create in the database yet).
Install these npm packages (exact names): three, @react-three/fiber, @react-three/drei, zustand, i18next, react-i18next, suncalc, @tabler/icons-react, idb, and dev dependencies @types/three, vitest. Use three.js for all 3D work in this project.
Create the folder structure from the Knowledge file with placeholder files. Each placeholder is a small TypeScript file that exports nothing meaningful yet but has a one-line comment describing its future purpose:
src/map/engine/shaders/bend.glsl.ts, src/map/engine/bendMath.ts, src/map/engine/bendMath.test.ts, src/map/engine/terrainLOD/index.ts, src/map/engine/projection/index.ts, src/map/engine/workers/README.md — every file under src/map/engine/ must start with the comment line // LOCKED: engine code — modify only on explicit engine tasks.
src/map/scenes/BentWorldScene.tsx, src/map/scenes/Map2DScene.tsx, src/map/scenes/SceneSwitcher.tsx
src/map/layers/README.md (explains: one file per layer)
src/map/data/proxy.ts, src/map/data/README.md
src/map/store/mapStore.ts — create a real zustand store with this initial shape and sensible defaults: userPoint: { lat: 61.6364, lon: 8.3125 } (Galdhøpiggen), heading: 0, cameraHeight: 1200, time: new Date(), followNow: true, mode: 'bent' | 'classic3d' | '2d' (default 'bent'), bend: { radiusKm: 6, flatZoneKm: 2, remap: 0.5, axisWeight: [1, 0] }, layers: Record<string, boolean> (empty), plus setter actions for each field.
src/map/ui/README.md
src/features/README.md (account, admin, privacy, chat, lists, operations will live here)
src/i18n/index.ts, src/i18n/nb.json, src/i18n/en.json — initialise i18next with nb as default and en as fallback; include only the strings used by the placeholder page.
Design tokens in src/index.css and tailwind.config.ts, exactly as in the Knowledge "Design guidelines": background 
#0A0E17, text 
#EDF1F7 / 
#93A1B5, accent 
#3FE8B0, accent-2 
#A78BFA, status colours, glass panel values. Load Google Fonts Instrument Serif (400, 400 italic) and Geist (fallback Inter). Set font-variant-numeric: tabular-nums on a .tabular utility class. Prepare a data-theme="light" variant with the "map paper" colours (
#F6F2E9, 
#233A5E, 
#C1502E) but do not build a theme switcher yet.
Placeholder page at /: full-viewport background 
#0A0E17, the word "Himinrond" centred in Instrument Serif italic at about 72px, and beneath it one line in Geist, text colour 
#93A1B5: t('tagline') → nb: "himmelens rand", en: "the sky's rim". Nothing else. No header, no nav.
Add a minimal vitest config so bendMath.test.ts (containing one trivial passing test) runs.
Guidelines
Follow the Knowledge file's folder structure and naming exactly; do not invent additional top-level folders.
Keep placeholder files tiny. Do not implement 3D, tiles, auth or any data fetching in this step.
TypeScript strict mode on. No any.
All user-visible text goes through i18next, even on this placeholder page.
Constraints
Do not create any database tables, edge functions or storage buckets yet.
Do not add any packages beyond the list above.
Do not add a router library yet unless the default Lovable template already includes one; if it does, keep it.
Make sure the project builds and the preview renders without console errors.
End your response with the exact list of files you created or changed.

Ask me any questions you need in order to fully understand this setup before you begin — otherwise proceed.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8df2ea63-2252-40b4-b999-ddda268b880f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
