/**
 * 存储适配器接口
 *
 * 抽象出「模板 + 模拟历史」的持久化契约，使上层（store/UI）与具体存储解耦：
 *  - 本地：Dexie / IndexedDB（localAdapter）
 *  - 未来：账号云端（remoteAdapter 实现同一接口即可无缝替换）
 *
 * 设计为「分层降级」：无 IndexedDB 环境（如隐私模式）可回退内存实现，不白屏。
 */
import type {
  BattlePreset, Equipment, Hero, SavedSimulation, Skill, Talent, TalentBook,
} from '../core/types';

/** 各集合统一记录类型（id 为主键） */
export interface StoredPreset { id: string; name: string; createdAt: string; tags: string[] }

export interface StorageSnapshot {
  heroes: Hero[];
  equipment: Equipment[];
  skills: Skill[];
  talents: Talent[];
  talentBooks: TalentBook[];
  battlePresets: BattlePreset[];
  savedSimulations: SavedSimulation[];
}

export type PresetKind = 'hero' | 'equipment' | 'skill' | 'talent' | 'talentBook' | 'preset' | 'sim';

export interface StorageAdapter {
  readonly name: string;
  readonly ready: Promise<void>;

  // 英雄
  listHeroes(): Promise<Hero[]>;
  saveHero(h: Hero): Promise<void>;
  deleteHero(id: string): Promise<void>;

  // 装备
  listEquipment(): Promise<Equipment[]>;
  saveEquipment(e: Equipment): Promise<void>;
  deleteEquipment(id: string): Promise<void>;

  // 技能
  listSkills(): Promise<Skill[]>;
  saveSkill(s: Skill): Promise<void>;
  deleteSkill(id: string): Promise<void>;

  // 天赋
  listTalents(): Promise<Talent[]>;
  saveTalent(t: Talent): Promise<void>;
  deleteTalent(id: string): Promise<void>;

  // 天赋页
  listTalentBooks(): Promise<TalentBook[]>;
  saveTalentBook(b: TalentBook): Promise<void>;
  deleteTalentBook(id: string): Promise<void>;

  // 战斗方案模板
  listBattlePresets(): Promise<BattlePreset[]>;
  saveBattlePreset(p: BattlePreset): Promise<void>;
  deleteBattlePreset(id: string): Promise<void>;

  // 模拟历史
  listSavedSimulations(): Promise<SavedSimulation[]>;
  saveSimulation(s: SavedSimulation): Promise<void>;
  deleteSimulation(id: string): Promise<void>;

  // 批量替换（导入备份时整体写入 / 云端同步冲突时覆盖）
  replaceAll(data: StorageSnapshot): Promise<void>;

  // 导出当前全量数据（备份文件内容）
  exportSnapshot(): Promise<StorageSnapshot>;

  favorite(kind: PresetKind, id: string, value: boolean): Promise<void>;
}

/** 内存适配器：IndexedDB 不可用时的降级/测试实现 */
export class MemoryAdapter implements StorageAdapter {
  readonly name = 'memory';
  readonly ready: Promise<void> = Promise.resolve();
  private heroes = new Map<string, Hero>();
  private equip = new Map<string, Equipment>();
  private skills = new Map<string, Skill>();
  private talents = new Map<string, Talent>();
  private talentBooks = new Map<string, TalentBook>();
  private presets = new Map<string, BattlePreset>();
  private sims = new Map<string, SavedSimulation>();

  async listHeroes() { return [...this.heroes.values()]; }
  async saveHero(h: Hero) { this.heroes.set(h.id, structuredClone(h)); }
  async deleteHero(id: string) { this.heroes.delete(id); }

  async listEquipment() { return [...this.equip.values()]; }
  async saveEquipment(e: Equipment) { this.equip.set(e.id, structuredClone(e)); }
  async deleteEquipment(id: string) { this.equip.delete(id); }

  async listSkills() { return [...this.skills.values()]; }
  async saveSkill(s: Skill) { this.skills.set(s.id, structuredClone(s)); }
  async deleteSkill(id: string) { this.skills.delete(id); }

  async listTalents() { return [...this.talents.values()]; }
  async saveTalent(t: Talent) { this.talents.set(t.id, structuredClone(t)); }
  async deleteTalent(id: string) { this.talents.delete(id); }

  async listTalentBooks() { return [...this.talentBooks.values()]; }
  async saveTalentBook(b: TalentBook) { this.talentBooks.set(b.id, structuredClone(b)); }
  async deleteTalentBook(id: string) { this.talentBooks.delete(id); }

  async listBattlePresets() { return [...this.presets.values()]; }
  async saveBattlePreset(p: BattlePreset) { this.presets.set(p.id, structuredClone(p)); }
  async deleteBattlePreset(id: string) { this.presets.delete(id); }

  async listSavedSimulations() { return [...this.sims.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); }
  async saveSimulation(s: SavedSimulation) { this.sims.set(s.id, structuredClone(s)); }
  async deleteSimulation(id: string) { this.sims.delete(id); }

  async replaceAll(d: StorageSnapshot) {
    this.heroes = new Map(d.heroes.map((x) => [x.id, structuredClone(x)]));
    this.equip = new Map(d.equipment.map((x) => [x.id, structuredClone(x)]));
    this.skills = new Map(d.skills.map((x) => [x.id, structuredClone(x)]));
    this.talents = new Map(d.talents.map((x) => [x.id, structuredClone(x)]));
    this.talentBooks = new Map(d.talentBooks.map((x) => [x.id, structuredClone(x)]));
    this.presets = new Map(d.battlePresets.map((x) => [x.id, structuredClone(x)]));
    this.sims = new Map(d.savedSimulations.map((x) => [x.id, structuredClone(x)]));
  }

  async exportSnapshot() {
    return {
      heroes: [...this.heroes.values()],
      equipment: [...this.equip.values()],
      skills: [...this.skills.values()],
      talents: [...this.talents.values()],
      talentBooks: [...this.talentBooks.values()],
      battlePresets: [...this.presets.values()],
      savedSimulations: [...this.sims.values()],
    };
  }

  async favorite(kind: PresetKind, id: string, value: boolean) {
    if (kind === 'hero') {
      const m = this.heroes.get(id);
      if (m) this.heroes.set(id, ({ ...m, favorite: value } as unknown) as Hero);
      return;
    }
    if (kind === 'equipment') {
      const m = this.equip.get(id);
      if (m) this.equip.set(id, ({ ...m, favorite: value } as unknown) as Equipment);
      return;
    }
    if (kind === 'skill') {
      const m = this.skills.get(id);
      if (m) this.skills.set(id, ({ ...m, favorite: value } as unknown) as Skill);
      return;
    }
    if (kind === 'talent') {
      const m = this.talents.get(id);
      if (m) this.talents.set(id, ({ ...m, favorite: value } as unknown) as Talent);
      return;
    }
    if (kind === 'talentBook') {
      const m = this.talentBooks.get(id);
      if (m) this.talentBooks.set(id, ({ ...m, favorite: value } as unknown) as TalentBook);
      return;
    }
    if (kind === 'preset') {
      const m = this.presets.get(id);
      if (m) this.presets.set(id, ({ ...m, favorite: value } as unknown) as BattlePreset);
      return;
    }
    if (kind === 'sim') {
      const m = this.sims.get(id);
      if (m) this.sims.set(id, ({ ...m, favorite: value } as unknown) as SavedSimulation);
    }
  }
}

/** 全局单例内存适配器（供降级 / 测试 / 预渲染使用） */
export const memoryAdapter = new MemoryAdapter();