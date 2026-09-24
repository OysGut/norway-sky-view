# Engine workers

Web Workers for heavy engine work: terrain tile decoding, mesh building and
elevation sampling off the main thread. One worker per responsibility.

## terrariumDecode.worker.ts

Fetches one Terrarium PNG tile, rasterises it with `OffscreenCanvas` and decodes
it to a `Float32Array` of metres (`terrain/terrarium.ts`). The buffer is
_transferred_ back, not copied.

Protocol (`terrariumProtocol.ts`): request `{ type: 'decode', id, z, x, y }` →
response `{ type: 'decoded', id, z, x, y, width, height, heights, fetchMs, decodeMs, bytes }`
or `{ type: 'error', id, error }`. Use `terrariumClient.ts#requestTile(z, x, y)`
from the main thread; it owns a small pool of workers (2–4, one per spare core) and
matches replies by id. Every request for a given tile goes to the same worker.

Caching, fastest first: each worker keeps the last 128 decoded tiles in memory
(`terrainLOD/memoryLru.ts`, with in-flight de-duplication), then IndexedDB
(`terrainLOD/tileCache.ts`), then the network. Re-meshing a tile whose rim or hole
changed — which happens to most tiles near the user each time the rings shift one
tile — is therefore a memory hit for the tile and its neighbours. Cached arrays are
shared inside the worker and never transferred; decode replies send a copy.
