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

import {
  lonLatToEnu,
  lonLatToTilePixel,
  type LonLat,
  type LonLatBounds,
} from "@/map/engine/projection";
import { sampleBilinear } from "@/map/engine/terrain/terrarium";
import { applyBendToMaterial } from "@/map/engine/shaders/bendMaterial";
import type { BendUniforms } from "@/map/engine/shaders/bend.glsl";
import {
  DEFAULT_RINGS,
  FAST_SPEED_MPS,
  planRings,
  ringsForSpeed,
  type RingSpec,
  type TileJob,
} from "@/map/engine/terrainLOD/rings";
import { requestMesh, requestTile } from "@/map/engine/workers/terrariumClient";
import type { DecodedTile } from "@/map/engine/workers/terrariumProtocol";
import { SYNTHETIC_LAYER, WIREFRAME_LAYER } from "@/map/scenes/cameraModel";
import { useMapStore } from "@/map/store/mapStore";

const PLACEHOLDER = new THREE.Color("#3a4756");
const SYNTHETIC_TINT = new THREE.Color("#8fa38a");
/** Re-plan when the user has moved this far (metres) since the last plan. */
const REPLAN_DISTANCE_M = 400;
/** Smoothing of the speed estimate (per second). */
const SPEED_SMOOTHING = 6;

/** Concurrent mesh requests in flight. */
const MAX_IN_FLIGHT = 6;
/**
 * Tiles are kept (hidden) after they leave the plan so coming back shows them at once
 * instead of re-fetching and re-meshing; beyond this many records the least recently
 * wanted ones are evicted. ≈ 100 records are in the plan at any time.
 */
const MAX_RECORDS = 350;
/** Tiles within this distance of a favourite place (searched / flown to) are evicted last. */
const FAVOURITE_RADIUS_M = 25_000;
/** Eviction priority bonus for favourites, in ms of "recency". */
const FAVOURITE_BONUS_MS = 6 * 60 * 60 * 1000;
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

function boundsOverlap(a: LonLatBounds, b: LonLatBounds): boolean {
  return a.west < b.east && b.west < a.east && a.south < b.north && b.south < a.north;
}

function kartverketTileUrl(layer: string, z: number, x: number, y: number): string {
  return `https://cache.kartverket.no/v1/wmts/1.0.0/${layer}/default/webmercator/${z}/${y}/${x}.png`;
}

interface TileRecord {
  job: TileJob;
  /** z/x/y — shared by records of the same tile with different holes/rims */
  tileKey: string;
  mesh: THREE.Mesh | null;
  material: THREE.MeshLambertMaterial;
  texture: THREE.Texture | null;
  state: "queued" | "loading" | "ready" | "failed";
  disposed: boolean;
  /** In the current plan. Unwanted records are retained hidden until evicted. */
  wanted: boolean;
  lastWantedAt: number;
  /** Wanted-but-not-ready records overlapping this (unwanted) one: it stays visible until they are ready. */
  blockers: Set<string>;
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
  /** Loaded textures by tile key, shared by every record of that tile. */
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly textureLoader = new THREE.TextureLoader();
  private favourites: readonly LonLat[] = [];
  private inFlight = 0;
  private lastPlanAt: LonLat | null = null;
  private synthetic = false;
  private lastUpdateAt: { point: LonLat; time: number } | null = null;
  private speedMps = 0;
  private activeSpecs: readonly RingSpec[] = DEFAULT_RINGS;
  /** Height tile under the user for ground sampling. */
  private groundTile: DecodedTile | null = null;
  private groundTileKey = "";
  private groundRequestKey = "";
  private groundRetryAt = 0;

  constructor(
    private origin: LonLat,
    private readonly uniforms: BendUniforms,
    private readonly maxAnisotropy: number,
  ) {
    this.group.name = "terrain";
    this.textureLoader.setCrossOrigin("anonymous");
  }

  /** Move the ENU origin: every tile is placed relative to it, so all tiles are rebuilt. */
  rebase(origin: LonLat): void {
    this.origin = origin;
    this.lastPlanAt = null;
    for (const key of [...this.tiles.keys()]) this.drop(key);
  }

  get currentOrigin(): LonLat {
    return this.origin;
  }

  /** Called every frame; cheap unless a re-plan is due. */
  update(
    userPoint: LonLat,
    synthetic: boolean,
    wireframe: boolean,
    favourites: readonly LonLat[] = [],
  ): void {
    this.favourites = favourites;
    if (synthetic !== this.synthetic) {
      this.synthetic = synthetic;
      this.lastPlanAt = null; // force a full re-plan with the new source
      this.groundTile = null;
      this.groundTileKey = "";
      this.groundRequestKey = "";
      this.groundRetryAt = 0;
      for (const key of [...this.tiles.keys()]) this.drop(key);
    }
    this.trackSpeed(userPoint);
    const specs = ringsForSpeed(this.speedMps);
    if (specs !== this.activeSpecs) {
      this.activeSpecs = specs;
      this.lastPlanAt = null; // the ring set changed: plan again right away
    }
    // no point sampling the ground while flying over it at hundreds of km/s
    if (this.speedMps < FAST_SPEED_MPS) this.trackGround(userPoint);
    if (this.lastPlanAt) {
      const d = lonLatToEnu(this.lastPlanAt, userPoint);
      if (Math.hypot(d.east, d.north) < this.replanDistance()) {
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

  /** Smoothed ground speed of the user point, metres per second. */
  private trackSpeed(userPoint: LonLat): void {
    const now = performance.now();
    const last = this.lastUpdateAt;
    if (last) {
      const dt = Math.max(1e-3, (now - last.time) / 1000);
      const d = lonLatToEnu(last.point, userPoint);
      const instant = Math.hypot(d.east, d.north) / dt;
      const k = 1 - Math.exp(-dt * SPEED_SMOOTHING);
      this.speedMps += (instant - this.speedMps) * k;
    }
    this.lastUpdateAt = { point: { ...userPoint }, time: now };
  }

  /** Re-plan distance: 400 m normally, half a tile of the finest active ring when flying. */
  private replanDistance(): number {
    if (this.activeSpecs === DEFAULT_RINGS) return REPLAN_DISTANCE_M;
    const finest = this.activeSpecs[0];
    if (!finest) return REPLAN_DISTANCE_M;
    // tile width at 61° N ≈ 40 075 km · cos(61°) / 2^z
    const tileM = (40_075_000 * 0.4848) / 2 ** finest.zoom;
    return Math.max(REPLAN_DISTANCE_M, tileM * 0.5);
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
    const jobs = planRings(userPoint, this.activeSpecs);
    const wantedKeys = new Set(jobs.map((j) => j.jobKey));
    const now = performance.now();
    for (const [key, record] of this.tiles) {
      record.wanted = wantedKeys.has(key);
      if (record.wanted) record.lastWantedAt = now;
    }
    for (const job of jobs) {
      if (this.tiles.has(job.jobKey)) continue;
      const tileKey = `${job.z}/${job.x}/${job.y}`;
      const material = applyBendToMaterial(
        new THREE.MeshLambertMaterial({
          color: this.synthetic ? SYNTHETIC_TINT : PLACEHOLDER,
          side: THREE.DoubleSide,
        }),
        this.uniforms,
      );
      const record: TileRecord = {
        job,
        tileKey,
        mesh: null,
        material,
        texture: null,
        state: "queued",
        disposed: false,
        wanted: true,
        lastWantedAt: now,
        blockers: new Set(),
        meshAttempts: 0,
        meshRetryAt: 0,
        textureAttempts: 0,
      };
      // a texture already loaded for this tile (earlier hole/rim) is reused at once
      const texture = this.textures.get(tileKey);
      if (texture) this.applyTexture(record, texture);
      this.tiles.set(job.jobKey, record);
    }
    this.assignBlockers();
    this.evict();
    this.updateVisibility();
  }

  /** Each unwanted record stays visible while wanted records covering its area are still loading. */
  private assignBlockers(): void {
    const pending: TileRecord[] = [];
    for (const r of this.tiles.values()) if (r.wanted && r.state !== "ready") pending.push(r);
    for (const r of this.tiles.values()) {
      r.blockers.clear();
      if (r.wanted || r.state !== "ready") continue;
      for (const w of pending)
        if (boundsOverlap(r.job.bounds, w.job.bounds)) r.blockers.add(w.job.jobKey);
    }
  }

  /** A wanted record became ready: it no longer blocks the hiding of the tiles it replaces. */
  private releaseBlocker(jobKey: string): void {
    for (const r of this.tiles.values()) r.blockers.delete(jobKey);
  }

  private updateVisibility(): void {
    for (const r of this.tiles.values()) {
      if (!r.mesh) continue;
      r.mesh.visible = r.state === "ready" && (r.wanted || r.blockers.size > 0);
    }
  }

  private isFavourite(record: TileRecord): boolean {
    const b = record.job.bounds;
    for (const f of this.favourites) {
      const dLat = FAVOURITE_RADIUS_M / 111_132;
      const dLon = FAVOURITE_RADIUS_M / (111_412 * Math.cos((f.lat * Math.PI) / 180));
      if (
        boundsOverlap(b, {
          west: f.lon - dLon,
          east: f.lon + dLon,
          south: f.lat - dLat,
          north: f.lat + dLat,
        })
      ) {
        return true;
      }
    }
    return false;
  }

  /** Drop the least valuable hidden, unwanted records until under budget. */
  private evict(): void {
    if (this.tiles.size <= MAX_RECORDS) return;
    const candidates = [...this.tiles.values()]
      .filter((r) => !r.wanted && r.blockers.size === 0)
      .map((r) => ({ r, score: r.lastWantedAt + (this.isFavourite(r) ? FAVOURITE_BONUS_MS : 0) }))
      .sort((a, b) => a.score - b.score);
    let excess = this.tiles.size - MAX_RECORDS;
    for (const c of candidates) {
      if (excess <= 0) break;
      this.drop(c.r.job.jobKey);
      excess--;
    }
  }

  /** Start queued jobs (and failed jobs whose backoff has elapsed), finest zoom first, up to the concurrency limit. */
  private pump(): void {
    if (this.inFlight >= MAX_IN_FLIGHT) return;
    const now = performance.now();
    const ready = [...this.tiles.values()]
      .filter(
        (t) => t.wanted && (t.state === "queued" || (t.state === "failed" && now >= t.meshRetryAt)),
      )
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
      mesh.visible = false;
      this.group.add(mesh);
      record.mesh = mesh;
      record.state = "ready";
      this.releaseBlocker(job.jobKey);
      this.updateVisibility();

      if (!this.synthetic && !record.texture) this.loadTexture(record);
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

  private applyTexture(record: TileRecord, texture: THREE.Texture): void {
    record.texture = texture;
    record.material.map = texture;
    record.material.color.set("#ffffff");
    record.material.needsUpdate = true;
  }

  private loadTexture(record: TileRecord): void {
    const { job } = record;
    const cached = this.textures.get(record.tileKey);
    if (cached) {
      this.applyTexture(record, cached);
      return;
    }
    this.textureLoader.load(
      kartverketTileUrl("topo", job.z, job.x, job.y),
      (texture) => {
        const existing = this.textures.get(record.tileKey);
        if (record.disposed || existing) {
          texture.dispose();
          if (existing && !record.disposed) this.applyTexture(record, existing);
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = this.maxAnisotropy;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.needsUpdate = true;
        this.textures.set(record.tileKey, texture);
        // every record of this tile (old and new hole/rim) gets it
        for (const r of this.tiles.values()) {
          if (r.tileKey === record.tileKey && !r.texture) this.applyTexture(r, texture);
        }
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
    record.material.dispose();
    this.tiles.delete(key);
    // the texture lives as long as any record of the tile does
    let shared = false;
    for (const r of this.tiles.values()) if (r.tileKey === record.tileKey) shared = true;
    if (!shared) {
      this.textures.get(record.tileKey)?.dispose();
      this.textures.delete(record.tileKey);
    }
    for (const r of this.tiles.values()) r.blockers.delete(key);
  }

  dispose(): void {
    for (const key of [...this.tiles.keys()]) this.drop(key);
  }

  get stats(): {
    tiles: number;
    ready: number;
    loading: number;
    wanted: number;
    visible: number;
    textures: number;
  } {
    let ready = 0;
    let loading = 0;
    let wanted = 0;
    let visible = 0;
    for (const t of this.tiles.values()) {
      if (t.state === "ready") ready++;
      if (t.state === "loading" || t.state === "queued") loading++;
      if (t.wanted) wanted++;
      if (t.mesh?.visible) visible++;
    }
    return {
      tiles: this.tiles.size,
      ready,
      loading,
      wanted,
      visible,
      textures: this.textures.size,
    };
  }
}

export function TerrainLayer({
  origin,
  uniforms,
}: {
  /** ENU origin; when the scene re-bases it, the layer rebuilds around the new origin. */
  origin: React.RefObject<LonLat>;
  uniforms: BendUniforms;
}) {
  const gl = useThree((s) => s.gl);
  const manager = useMemo(
    () => new TerrainManager(origin.current, uniforms, gl.capabilities.getMaxAnisotropy()),
    [origin, uniforms, gl],
  );
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const parent = groupRef.current;
    if (!parent) return;
    parent.add(manager.group);
    if (import.meta.env.DEV) {
      // debugging aid: inspect tile state from the console / headless tests
      (window as unknown as { __himinrondTerrain?: TerrainManager }).__himinrondTerrain = manager;
    }
    return () => {
      parent.remove(manager.group);
      manager.dispose();
    };
  }, [manager]);

  useFrame(() => {
    const s = useMapStore.getState();
    if (origin.current !== manager.currentOrigin) manager.rebase(origin.current);
    manager.update(
      s.userPoint,
      s.layers[SYNTHETIC_LAYER] === true,
      s.layers[WIREFRAME_LAYER] === true,
      s.favouritePlaces,
    );
    const ground = manager.groundHeightAt(s.userPoint);
    if (ground !== null && Math.abs(ground - s.groundHeight) > 0.05) s.setGroundHeight(ground);
  });

  return <group ref={groupRef} name="terrainLayer" />;
}
