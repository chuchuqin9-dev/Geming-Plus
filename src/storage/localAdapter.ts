/**
 * 本地持久化适配器：Dexie（IndexedDB）
 *
 * 特点：
 *  - 主键 id，为常用字段建立索引（name / favorite / createdAt）。
 *  - 全部写操作带结构性副本，避免引用泄漏（store 里的对象被 UI 改坏）。
 *  - 复用 MemoryAdapter 作为 fallback：IndexedDB 初始化失败时静默降级，不白屏。
 */
import Dexie, { type EntityTable } from 'dexie';
import type {
  BattlePreset, Equipment, Hero, SavedSimulation, Skill,
} from '../core/types';
import { CURRENT_SCHEMA_VERSION } from './schema';
import { memoryAdapter, type StorageAdapter, type StorageSnapshot } from './adapter';

export const DB_NAME = 'moba-simulator';
export const DB_VERSION = 2;

interface DbSchema {
  heroes: Hero;
  equipment: Equipment;
  skills: Skill;
  battlePresets: BattlePreset;
  savedSimulations: SavedSimulation;
}

class MobaDatabase extends Dexie {
  heroes!: EntityTable<Hero, 'id'>;
  equipment!: EntityTable<Equipment, 'id'>;
  skills!: EntityTable<Skill, 'id'>;
  battlePresets!: EntityTable<BattlePreset, 'id'>;
  savedSimulations!: EntityTable<SavedSimulation, 'id'>;

  constructor() {
    super(DB_NAME);
    const idx = {
      heroes: 'id, name, favorite',
      equipment: 'id, name, favorite',
      skills: 'id, name',
      battlePresets: 'id, name, favorite',
      savedSimulations: 'id, name, favorite, createdAt',
    } as const;
    this.version(DB_VERSION).stores(idx);
  }
}

const db = new MobaDatabase();
const mem = memoryAdapter;

async function safeFallback<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback();
  }
}

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** Dexie 本地适配器 */
class LocalAdapterImpl implements StorageAdapter {
  readonly name = 'local';
  readonly ready: Promise<void>;

  constructor() {
    // 探测 IndexedDB 可用性；不可用则后续操作全部落到内存适配器
    this.ready = Promise.resolve()
      .then(async () => { await db.open(); })
      .catch(() => { /* 降级到内存 */ });
  }

  async listHeroes() { return safeFallback(() => db.heroes.toArray(), () => mem.listHeroes()); }
  async saveHero(h: Hero) { return safeFallback(async () => { await db.heroes.put(clone(h)); }, () => mem.saveHero(h)); }
  async deleteHero(id: string) { return safeFallback(async () => { await db.heroes.delete(id); }, () => mem.deleteHero(id)); }

  async listEquipment() { return safeFallback(() => db.equipment.toArray(), () => mem.listEquipment()); }
  async saveEquipment(e: Equipment) { return safeFallback(async () => { await db.equipment.put(clone(e)); }, () => mem.saveEquipment(e)); }
  async deleteEquipment(id: string) { return safeFallback(async () => { await db.equipment.delete(id); }, () => mem.deleteEquipment(id)); }

  async listSkills() { return safeFallback(() => db.skills.toArray(), () => mem.listSkills()); }
  async saveSkill(s: Skill) { return safeFallback(async () => { await db.skills.put(clone(s)); }, () => mem.saveSkill(s)); }
  async deleteSkill(id: string) { return safeFallback(async () => { await db.skills.delete(id); }, () => mem.deleteSkill(id)); }

  async listBattlePresets() { return safeFallback(() => db.battlePresets.toArray(), () => mem.listBattlePresets()); }
  async saveBattlePreset(p: BattlePreset) { return safeFallback(async () => { await db.battlePresets.put(clone(p)); }, () => mem.saveBattlePreset(p)); }
  async deleteBattlePreset(id: string) { return safeFallback(async () => { await db.battlePresets.delete(id); }, () => mem.deleteBattlePreset(id)); }

  async listSavedSimulations() {
    return safeFallback(
      () => db.savedSimulations.orderBy('createdAt').reverse().toArray(),
      () => mem.listSavedSimulations(),
    );
  }
  async saveSimulation(s: SavedSimulation) { return safeFallback(async () => { await db.savedSimulations.put(clone(s)); }, () => mem.saveSimulation(s)); }
  async deleteSimulation(id: string) { return safeFallback(async () => { await db.savedSimulations.delete(id); }, () => mem.deleteSimulation(id)); }

  async replaceAll(data: StorageSnapshot) {
    // 迁移到当前 schema 后整体覆写（导入备份 / 云端拉取）
    const d = {
      heroes: data.heroes.map((x) => ({ schemaVersion: CURRENT_SCHEMA_VERSION as number, ...clone(x) })),
      equipment: data.equipment.map((x) => ({ schemaVersion: CURRENT_SCHEMA_VERSION as number, ...clone(x) })),
      skills: data.skills.map((x) => ({ schemaVersion: CURRENT_SCHEMA_VERSION as number, ...clone(x) })),
      battlePresets: data.battlePresets.map((x) => ({ schemaVersion: CURRENT_SCHEMA_VERSION as number, ...clone(x) })),
      savedSimulations: data.savedSimulations.map((x) => ({ schemaVersion: CURRENT_SCHEMA_VERSION as number, ...clone(x) })),
    };
    await safeFallback(
      () => db.transaction('rw', [db.heroes, db.equipment, db.skills, db.battlePresets, db.savedSimulations], async () => {
        await Promise.all([
          db.heroes.clear(), db.equipment.clear(), db.skills.clear(),
          db.battlePresets.clear(), db.savedSimulations.clear(),
        ]);
        await Promise.all([
          db.heroes.bulkAdd(d.heroes as Hero[]),
          db.equipment.bulkAdd(d.equipment as Equipment[]),
          db.skills.bulkAdd(d.skills as Skill[]),
          db.battlePresets.bulkAdd(d.battlePresets as BattlePreset[]),
          db.savedSimulations.bulkAdd(d.savedSimulations as SavedSimulation[]),
        ]);
      }),
      () => mem.replaceAll(data),
    );
  }

  async exportSnapshot(): Promise<StorageSnapshot> {
    return safeFallback(
      async () => ({
        heroes: await db.heroes.toArray(),
        equipment: await db.equipment.toArray(),
        skills: await db.skills.toArray(),
        battlePresets: await db.battlePresets.toArray(),
        savedSimulations: await db.savedSimulations.toArray(),
      }),
      () => mem.exportSnapshot(),
    );
  }

  async favorite(kind: 'hero' | 'equipment' | 'skill' | 'preset' | 'sim', id: string, value: boolean) {
    const apply = async (tbl: { get: (id: string) => Promise<{ favorite?: boolean } | undefined>; update: (id: string, changes: object) => Promise<number> }) => {
      const row = await safeFallback(async () => tbl.get(id), async () => ({ favorite: false }));
      if (row && typeof row === 'object') {
        await safeFallback(async () => tbl.update(id, { favorite: value }), async () => { let r = 0; return r; });
      } else {
        await mem.favorite(kind, id, value);
      }
    };
    switch (kind) {
      case 'hero': return apply(db.heroes as unknown as { get: (id: string) => Promise<{ favorite?: boolean } | undefined>; update: (id: string, changes: object) => Promise<number>; });
      case 'equipment': return apply(db.equipment as unknown as { get: (id: string) => Promise<{ favorite?: boolean } | undefined>; update: (id: string, changes: object) => Promise<number>; });
      case 'skill': return apply(db.skills as unknown as { get: (id: string) => Promise<{ favorite?: boolean } | undefined>; update: (id: string, changes: object) => Promise<number>; });
      case 'preset': return apply(db.battlePresets as unknown as { get: (id: string) => Promise<{ favorite?: boolean } | undefined>; update: (id: string, changes: object) => Promise<number>; });
      case 'sim': return apply(db.savedSimulations as unknown as { get: (id: string) => Promise<{ favorite?: boolean } | undefined>; update: (id: string, changes: object) => Promise<number>; });
    }
  }
}

/** 全局本地适配器单例 */
export const localAdapter: StorageAdapter = new LocalAdapterImpl();

/** 依据环境选择存储适配器（预留：未来登录时切到云适配器） */
export function defaultAdapter(): StorageAdapter {
  return localAdapter;
}