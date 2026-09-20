// Terrain layer: nested tile rings meshed from Terrarium heights in workers,
// textured with Kartverket topo tiles and lit. Tiles are managed imperatively
// (one THREE.Mesh each) for speed; React only owns the group and the lifecycle.
//
// Debug layers (mapStore.layers):
//   debug:synthetic  → procedural hills instead of fetched heights (offline testing)
//   debug:wireframe  → wireframe materials

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { lonLatToEnu, lonLatToTilePixel, type LonLat } from "@/map/engine/projection";
import { sampleBilinear } from "@/map/engine/terrain/terrarium";
import { applyBendToMaterial } from "@/map/engine/shaders/bendMaterial";
import type { BendUniforms } from "@/map/engine/shaders/bend.glsl";
import { planRings, type TileJob } from "@/map/engine/terrainLOD/rings";
import { requestMesh, requestTile } from "@/map/engine/workers/terrariumClient";
import type { DecodedTile } from "@/map/engine/workers/terrariumProtocol";
import { SYNTHETIC_LAYER, WIREFRAME_LAYER } from "@/map/scenes/cameraModel";
import { useMapStore } from "@/map/store/mapStore";

const PLACEHOLDER = new THREE.Color("#3a4756");
const SYNTHETIC_TINT = new THREE.Color("#8fa38a");
/** Re-plan when the user has moved this far (metres) since the last plan. */
const REPLAN_DISTANCE_M = 400;
/** Concurrent mesh requests in flight. */
const MAX_IN_FLIGHT = 6;
/** Zoom of the tile used to sample the ground height under the user. */
const GROUND_ZOOM = 13;
/** Ground-tile fetch failure backoff. */
const GROUND_RETRY_MS = 5_000;
/** Mesh retry backoff: 3 s, 6 s, 12 s, … capped at 60 s; unlimited attempts while a tile stays planned. */
const MESH_RETRY_BASE_MS = 3_000;
const MESH_RETRY_MAX_MS = 60_000;
/** Texture retries are finite — a couple of attempts with the same style of backoff, then give up. */
const TEXTURE_RETRY_BASE_MS = 3_000;
const TEXTURE_MAX_ATTEMPTS = 3;

function backoffMs(attempt: number, base: number, max: number): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

function kartverketTileUrl(layer: string, z: number, x: number, y: number): string {
  return `https://cache.kartverket.no/v1/wmts/1.0.0/${layer}/default/webmercator/${z}/${y}/${x}.png`;
}

interface TileRecord {
  job: TileJob;
  mesh: THREE.Mesh | null;
  material: THREE.MeshLambertMaterial;
  texture: THREE.Texture | null;
  state: "queued" | "loading" | "ready" | "failed";
  disposed: boolean;
  /** Failed mesh attempts so far; drives the retry backoff. */
  meshAttempts: number;
  /** Earliest time (performance.now()) a failed mesh may be retried. */
  meshRetryAt: number;
  /** Failed texture attempts so far. */
  textureAttempts: number;
}

/** Owns every terrain tile mesh under one group. */
class TerrainManager {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, TileRecord>();
  private readonly textureLoader = new THREE.TextureLoader();
  private inFlight = 0;
  private lastPlanAt: LonLat | null = null;
  private synthetic = false;
  /** Height tile under the user for ground sampling. */
  private groundTile: DecodedTile | null = null;
  private groundTileKey = "";
  private groundRequestKey = "";
  private groundRetryAt = 0;

  constructor(
    private readonly origin: LonLat,
    private readonly uniforms: BendUniforms,
    private readonly maxAnisotropy: number,
  ) {
    this.group.name = "terrain";
    this.textureLoader.setCrossOrigin("anonymous");
  }

  /** Called every frame; cheap unless a re-plan is due. */
  update(userPoint: LonLat, synthetic: boolean, wireframe: boolean): void {
    if (synthetic !== this.synthetic) {
      this.synthetic = synthetic;
      this.lastPlanAt = null; // force a full re-plan with the new source
      this.groundTile = null;
      this.groundTileKey = "";
      this.groundRequestKey = "";
      this.groundRetryAt = 0;
      for (const key of [...this.tiles.keys()]) this.drop(key);
    }
    this.trackGround(userPoint);
    if (this.lastPlanAt) {
      const d = lonLatToEnu(this.lastPlanAt, userPoint);
      if (Math.hypot(d.east, d.north) < REPLAN_DISTANCE_M) {
        this.pump();
        this.applyWireframe(wireframe);
        return;
      }
    }
    this.lastPlanAt = { ...userPoint };
    this.plan(userPoint);
    this.pump();
    this.applyWireframe(wireframe);
  }

  /** Keep the height tile under the user available for ground sampling. */
  private trackGround(userPoint: LonLat): void {
    const tp = lonLatToTilePixel(userPoint.lon, userPoint.lat, GROUND_ZOOM);
    const key = `${tp.z}/${tp.x}/${tp.y}`;
    if (key === this.groundTileKey || key === this.groundRequestKey) return;
    if (performance.now() < this.groundRetryAt) return;
    this.groundRequestKey = key;
    void requestTile(tp.z, tp.x, tp.y, this.synthetic)
      .then((tile) => {
        if (this.groundRequestKey !== key) return; // superseded
        this.groundTile = tile;
        this.groundTileKey = key;
      })
      .catch((error: unknown) => {
        if (this.groundRequestKey === key) this.groundRequestKey = "";
        this.groundRetryAt = performance.now() + GROUND_RETRY_MS;
        console.warn(
          "[terrain] ground tile failed:",
          error instanceof Error ? error.message : error,
        );
      });
  }

  /** Terrain height (m a.s.l.) under a point, or null until the ground tile is available. */
  groundHeightAt(point: LonLat): number | null {
    const t = this.groundTile;
    if (!t) return null;
    const tp = lonLatToTilePixel(point.lon, point.lat, t.z);
    if (tp.x !== t.x || tp.y !== t.y) return null;
    return Math.max(0, sampleBilinear(t.heights, t.width, t.height, tp.px, tp.py));
  }

  private plan(userPoint: LonLat): void {
    const jobs = planRings(userPoint);
    const wanted = new Set(jobs.map((j) => j.jobKey));
    for (const key of [...this.tiles.keys()]) if (!wanted.has(key)) this.drop(key);
    for (const job of jobs) {
      if (this.tiles.has(job.jobKey)) continue;
      const material = applyBendToMaterial(
        new THREE.MeshLambertMaterial({
          color: this.synthetic ? SYNTHETIC_TINT : PLACEHOLDER,
          side: THREE.DoubleSide,
        }),
        this.uniforms,
      );
      this.tiles.set(job.jobKey, {
        job,
        mesh: null,
        material,
        texture: null,
        state: "queued",
        disposed: false,
        meshAttempts: 0,
        meshRetryAt: 0,
        textureAttempts: 0,
      });
    }
  }

  /** Start queued jobs (and failed jobs whose backoff has elapsed), finest zoom first, up to the concurrency limit. */
  private pump(): void {
    if (this.inFlight >= MAX_IN_FLIGHT) return;
    const now = performance.now();
    const ready = [...this.tiles.values()]
      .filter((t) => t.state === "queued" || (t.state === "failed" && now >= t.meshRetryAt))
      .sort((a, b) => b.job.z - a.job.z);
    for (const record of ready) {
      if (this.inFlight >= MAX_IN_FLIGHT) break;
      void this.load(record);
    }
  }

  private async load(record: TileRecord): Promise<void> {
    record.state = "loading";
    this.inFlight++;
    const { job } = record;
    try {
      // tile extent in ENU metres (relative to the scene origin), and its centre
      const sw = lonLatToEnu(this.origin, { lon: job.bounds.west, lat: job.bounds.south });
      const ne = lonLatToEnu(this.origin, { lon: job.bounds.east, lat: job.bounds.north });
      const widthM = ne.east - sw.east;
      const depthM = ne.north - sw.north;
      const centerEast = (ne.east + sw.east) / 2;
      const centerNorth = (ne.north + sw.north) / 2;

      const result = await requestMesh({
        z: job.z,
        x: job.x,
        y: job.y,
        widthM,
        depthM,
        segments: job.segments,
        skirtDepth: job.skirtDepth,
        hole: job.hole,
        rim: job.rim,
        synthetic: this.synthetic,
      });
      if (record.disposed) return;
      record.meshAttempts = 0;
      record.meshRetryAt = 0;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(result.mesh.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(result.mesh.normals, 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(result.mesh.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(result.mesh.indices, 1));

      const mesh = new THREE.Mesh(geometry, record.material);
      mesh.position.set(centerEast, 0, -centerNorth);
      mesh.frustumCulled = false; // vertices move in the shader
      mesh.renderOrder = job.z; // finer rings draw after coarser ones
      mesh.name = job.jobKey;
      this.group.add(mesh);
      record.mesh = mesh;
      record.state = "ready";

      if (!this.synthetic) this.loadTexture(record);
    } catch (error) {
      record.state = "failed";
      record.meshAttempts++;
      record.meshRetryAt =
        performance.now() + backoffMs(record.meshAttempts, MESH_RETRY_BASE_MS, MESH_RETRY_MAX_MS);
      console.warn(
        `[terrain] tile ${job.jobKey} failed (attempt ${record.meshAttempts}, retrying):`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      this.inFlight--;
      this.pump();
    }
  }

  private loadTexture(record: TileRecord): void {
    const { job } = record;
    this.textureLoader.load(
      kartverketTileUrl("topo", job.z, job.x, job.y),
      (texture) => {
        if (record.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = this.maxAnisotropy;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.needsUpdate = true;
        record.texture = texture;
        record.material.map = texture;
        record.material.color.set("#ffffff");
        record.material.needsUpdate = true;
        record.textureAttempts = 0;
      },
      undefined,
      () => {
        record.textureAttempts++;
        if (record.disposed || record.textureAttempts >= TEXTURE_MAX_ATTEMPTS) {
          console.warn(
            `[terrain] texture failed, giving up after ${record.textureAttempts} attempt(s): ${job.jobKey}`,
          );
          return;
        }
        const delay = backoffMs(
          record.textureAttempts,
          TEXTURE_RETRY_BASE_MS,
          TEXTURE_RETRY_BASE_MS * 4,
        );
        console.warn(
          `[terrain] texture failed (attempt ${record.textureAttempts}, retrying in ${delay}ms): ${job.jobKey}`,
        );
        setTimeout(() => {
          if (!record.disposed) this.loadTexture(record);
        }, delay);
      },
    );
  }

  private applyWireframe(wireframe: boolean): void {
    for (const t of this.tiles.values()) {
      if (t.material.wireframe !== wireframe) {
        t.material.wireframe = wireframe;
        t.material.needsUpdate = true;
      }
    }
  }

  private drop(key: string): void {
    const record = this.tiles.get(key);
    if (!record) return;
    record.disposed = true;
    if (record.mesh) {
      this.group.remove(record.mesh);
      record.mesh.geometry.dispose();
    }
    record.texture?.dispose();
    record.material.dispose();
    this.tiles.delete(key);
  }

  dispose(): void {
    for (const key of [...this.tiles.keys()]) this.drop(key);
  }

  get stats(): { tiles: number; ready: number; loading: number } {
    let ready = 0;
    let loading = 0;
    for (const t of this.tiles.values()) {
      if (t.state === "ready") ready++;
      if (t.state === "loading" || t.state === "queued") loading++;
    }
    return { tiles: this.tiles.size, ready, loading };
  }
}

export function TerrainLayer({ origin, uniforms }: { origin: LonLat; uniforms: BendUniforms }) {
  const gl = useThree((s) => s.gl);
  const manager = useMemo(
    () => new TerrainManager(origin, uniforms, gl.capabilities.getMaxAnisotropy()),
    [origin, uniforms, gl],
  );
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const parent = groupRef.current;
    if (!parent) return;
    parent.add(manager.group);
    return () => {
      parent.remove(manager.group);
      manager.dispose();
    };
  }, [manager]);

  useFrame(() => {
    const s = useMapStore.getState();
    manager.update(
      s.userPoint,
      s.layers[SYNTHETIC_LAYER] === true,
      s.layers[WIREFRAME_LAYER] === true,
    );
    const ground = manager.groundHeightAt(s.userPoint);
    if (ground !== null && Math.abs(ground - s.groundHeight) > 0.05) s.setGroundHeight(ground);
  });

  return <group ref={groupRef} name="terrainLayer" />;
}
