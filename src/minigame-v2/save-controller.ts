import { ChunkEdits } from '../core/save/ChunkEdits.ts';
import type { ChunkSaveRecord, PlayerSave } from '../core/save/SaveGame.ts';
import type { WorldRegistry, WorldSummary } from '../core/save/WorldRegistry.ts';
import type { World } from '../core/world/World.ts';
import { FileSaveGame } from '../platform/file-save.ts';
import type { Platform } from '../platform/types.ts';
import { serializeContainers } from '../core/save/ContainerSave.ts';

export interface SaveControllerDeps {
  platform: Platform;
  registry: WorldRegistry;
  getCurrentWorld(): WorldSummary | null;
  getWorld(): World;
  snapshotPlayer(): PlayerSave;
}

/** 世界存档生命周期：打开、防抖保存、脏区块/容器/玩家写入。 */
export class SaveController {
  private save: FileSaveGame | null = null;
  private saving = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private playMark = Date.now();

  constructor(private readonly deps: SaveControllerDeps) {}

  get isOpen(): boolean {
    return this.save !== null;
  }

  static deleteWorld(worldId: string, platform: Platform): Promise<void> {
    return FileSaveGame.deleteWorld(worldId, platform.files);
  }

  async open(worldId: string): Promise<FileSaveGame> {
    this.close();
    this.save = await FileSaveGame.open(worldId, this.deps.platform.files);
    this.playMark = Date.now();
    return this.save;
  }

  close(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.save) {
      this.save.close();
      this.save = null;
    }
  }

  async persist(): Promise<void> {
    const save = this.save;
    const currentWorld = this.deps.getCurrentWorld();
    if (!save || !currentWorld || this.saving) return;
    this.saving = true;
    try {
      currentWorld.lastPlayed = Date.now();
      currentWorld.playTime = (currentWorld.playTime ?? 0) + Math.max(0, (Date.now() - this.playMark) / 1000);
      this.playMark = Date.now();
      this.deps.registry.update(currentWorld.id, {
        lastPlayed: currentWorld.lastPlayed,
        playTime: currentWorld.playTime,
      });
      await save.savePlayer(this.deps.snapshotPlayer());
      const world = this.deps.getWorld();
      const records: ChunkSaveRecord[] = [];
      for (const key of world.edits.dirtyKeys()) {
        const { dimension, cx, cz } = ChunkEdits.parseKey(key);
        const edits = world.edits.serialize(dimension, cx, cz);
        if (edits) records.push({ dimension, cx, cz, edits });
      }
      await save.saveChunks(records);
      await save.saveContainers(serializeContainers(world.containers));
      await save.saveMeta(save.buildMeta(world.seed, world.edits.totalEdits));
      world.edits.markSaved();
    } catch (error) {
      console.warn('[v2] save failed', error);
    } finally {
      this.saving = false;
    }
  }

  request(): void {
    if (!this.save) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persist();
    }, 1200);
  }
}
