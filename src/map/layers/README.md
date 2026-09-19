# Layers

One file per 3D layer. Layers read position/time/layer state from `mapStore`
only and take part in the Bent World by patching their materials with
`engine/shaders/bendMaterial.applyBendToMaterial` (shared uniforms from the scene).

- `TerrainLayer.tsx` — nested tile rings (z13 / z11 / z9) meshed from Terrarium
  heights in workers (`engine/terrainLOD`), Kartverket topo textures, Lambert
  lighting with bent normals. Samples the ground height under the user into
  `mapStore.groundHeight`. Debug layers: `debug:synthetic`, `debug:wireframe`.
