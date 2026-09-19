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
from the main thread; it owns a single worker instance and matches replies by id.
