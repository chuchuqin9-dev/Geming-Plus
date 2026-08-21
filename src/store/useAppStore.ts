/**
 * 全局状态（Zustand）
 *
 * 职责：
 *  - 持有英雄/装备/技能/战斗方案/模拟历史 五类实体
 *  - 提供 CRUD / 收藏 / 导入 / 导出 / 清空清场
 *  - 提供「战斗模拟」的当前配置与最近结果
 *
 * 存储层通过 StorageAdapter 抽象，接口统一，未来可无缝切换到云端适配器。
 */
import { create } from 'zustand';
import type {
  BattlePreset, CombatConfig, CombatResult, Equipment, Hero, SavedSimulation, Skill, Talent, TalentBook,
} from '../core/types';
import { type StorageAdapter, type StorageSnapshot } from '../storage/adapter';
import { defaultAdapter } from '../storage/localAdapter';
import { buildCombatConfig, validateConfig } from '../core/combatConfig';
import { runCombat } from '../core/engine/combatEngine';
import { uid, newHero, newDummy } from '../core/defaults';
import { buildBackup, downloadBackup, parseBackup } from '../storage/exports';
import { MAX_EQUIPMENT } from '../core/types';

interface AppState {
  adapter: StorageAdapter;
  ready: boolean;
  lastError: string | null;

  heroes: Hero[];
  equipment: Equipment[];
  skills: Skill[];
  talents: Talent[];
  talentBooks: TalentBook[];
  battlePresets: BattlePreset[];
  savedSimulations: SavedSimulation[];

  // 编辑器当前选中项
  selectedHeroId: string | null;
  selectedEqId: string | null;
  selectedSkillId: string | null;
  selectedTalentId: string | null;
  selectedTalentBookId: string | null;
  selectedPresetId: string | null;

  // 战斗模拟当前状态
  combatConfig: CombatConfig;
  result: CombatResult | null;
  running: boolean;

  // actions
  init: () => Promise<void>;
  upsertHero: (h: Hero) => Promise<void>;
  removeHero: (id: string) => Promise<void>;
  upsertEquipment: (e: Equipment) => Promise<void>;
  removeEquipment: (id: string) => Promise<void>;
  upsertSkill: (s: Skill) => Promise<void>;
  removeSkill: (id: string) => Promise<void>;
  upsertTalent: (t: Talent) => Promise<void>;
  removeTalent: (id: string) => Promise<void>;
  upsertTalentBook: (b: TalentBook) => Promise<void>;
  removeTalentBook: (id: string) => Promise<void>;
  upsertPreset: (p: BattlePreset) => Promise<void>;
  removePreset: (id: string) => Promise<void>;
  saveSimulation: (result: CombatResult, name?: string) => Promise<void>;
  removeSimulation: (id: string) => Promise<void>;
  toggleFavorite: (kind: 'hero' | 'equipment' | 'skill' | 'talent' | 'talentBook' | 'preset' | 'sim', id: string) => Promise<void>;

  selectHero: (id: string | null) => void;
  selectEq: (id: string | null) => void;
  selectSkill: (id: string | null) => void;
  selectTalent: (id: string | null) => void;
  selectTalentBook: (id: string | null) => void;
  selectPreset: (id: string | null) => void;

  setCombatConfig: (cfg: CombatConfig) => void;
  runSimulation: () => Promise<void>;
  clearResult: () => void;

  exportBackup: () => Promise<void>;
  importBackup: (text: string, mode: 'merge' | 'replace') => Promise<void>;
  reloadAll: () => Promise<void>;
  clearError: () => void;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const useAppStore = create<AppState>((set, get) => {
  const adapter = defaultAdapter();

  const reloadAll = async () => {
    const [heroes, equipment, skills, talents, talentBooks, battlePresets, savedSimulations] = await Promise.all([
      adapter.listHeroes(),
      adapter.listEquipment(),
      adapter.listSkills(),
      adapter.listTalents(),
      adapter.listTalentBooks(),
      adapter.listBattlePresets(),
      adapter.listSavedSimulations(),
    ]);
    set({ heroes, equipment, skills, talents, talentBooks, battlePresets, savedSimulations, ready: true });
  };

  const equipmentNameById = () => {
    const map: Record<string, string> = {};
    for (const e of get().equipment) map[e.id] = e.name;
    return map;
  };

  return {
    adapter,
    ready: false,
    lastError: null,
    heroes: [],
    equipment: [],
    skills: [],
    talents: [],
    talentBooks: [],
    battlePresets: [],
    savedSimulations: [],
    selectedHeroId: null,
    selectedEqId: null,
    selectedSkillId: null,
    selectedTalentId: null,
    selectedTalentBookId: null,
    selectedPresetId: null,
    combatConfig: buildCombatConfig({
      mode: 'dummy',
      durationSeconds: 30,
      randomMode: 'seeded',
      seed: 12345,
      heroA: newHero(),
      itemsA: [],
      dummy: newDummy(),
    }),
    result: null,
    running: false,

    init: async () => {
      await adapter.ready;
      await reloadAll();
    },

    upsertHero: async (h) => {
      await adapter.saveHero(h);
      await reloadAll();
    },
    removeHero: async (id) => { await adapter.deleteHero(id); await reloadAll(); },

    upsertEquipment: async (e) => {
      await adapter.saveEquipment(e);
      await reloadAll();
    },
    removeEquipment: async (id) => { await adapter.deleteEquipment(id); await reloadAll(); },

    upsertSkill: async (s) => { await adapter.saveSkill(s); await reloadAll(); },
    removeSkill: async (id) => { await adapter.deleteSkill(id); await reloadAll(); },

    upsertTalent: async (t) => { await adapter.saveTalent(t); await reloadAll(); },
    removeTalent: async (id) => { await adapter.deleteTalent(id); await reloadAll(); },

    upsertTalentBook: async (b) => { await adapter.saveTalentBook(b); await reloadAll(); },
    removeTalentBook: async (id) => { await adapter.deleteTalentBook(id); await reloadAll(); },

    upsertPreset: async (p) => { await adapter.saveBattlePreset(p); await reloadAll(); },
    removePreset: async (id) => { await adapter.deleteBattlePreset(id); await reloadAll(); },

    saveSimulation: async (result, name) => {
      const s: SavedSimulation = {
        id: uid('sim'), name: name || `模拟 ${new Date().toLocaleString()}`,
        createdAt: new Date().toISOString(), result: clone(result), tags: [], favorite: false,
      };
      await adapter.saveSimulation(s);
      await reloadAll();
    },
    removeSimulation: async (id) => { await adapter.deleteSimulation(id); await reloadAll(); },

    toggleFavorite: async (kind, id) => {
      const entry = (() => {
        if (kind === 'hero') return get().heroes.find((x) => x.id === id);
        if (kind === 'equipment') return get().equipment.find((x) => x.id === id);
        if (kind === 'skill') return get().skills.find((x) => x.id === id);
        if (kind === 'talent') return get().talents.find((x) => x.id === id);
        if (kind === 'talentBook') return get().talentBooks.find((x) => x.id === id);
        if (kind === 'preset') return get().battlePresets.find((x) => x.id === id);
        if (kind === 'sim') return get().savedSimulations.find((x) => x.id === id);
        return undefined;
      })() as { favorite?: boolean } | undefined;
      const next = !(entry?.favorite ?? false);
      await adapter.favorite(kind, id, next);
      await reloadAll();
    },

    selectHero: (id) => set({ selectedHeroId: id }),
    selectEq: (id) => set({ selectedEqId: id }),
    selectSkill: (id) => set({ selectedSkillId: id }),
    selectTalent: (id) => set({ selectedTalentId: id }),
    selectTalentBook: (id) => set({ selectedTalentBookId: id }),
    selectPreset: (id) => set({ selectedPresetId: id }),

    setCombatConfig: (cfg) => set({ combatConfig: cfg }),

    runSimulation: async () => {
      const { combatConfig } = get();
      const errors = validateConfig(combatConfig, equipmentNameById());
      if (errors.length) {
        set({ lastError: errors.map((e) => e.message).join('；') });
        return;
      }
      const byId = new Map(get().equipment.map((e) => [e.id, e]));
      set({ running: true, result: null });
      try {
        // 异步让出，避免阻塞 UI（长时模拟）
        const result = await Promise.resolve().then(() => runCombat(combatConfig, byId));
        set({ result, lastError: null });
      } catch (e) {
        set({ lastError: (e as Error).message || '模拟失败' });
      } finally {
        set({ running: false });
      }
    },
    clearResult: () => set({ result: null }),

    exportBackup: async () => {
      const snap: StorageSnapshot = await adapter.exportSnapshot();
      downloadBackup(buildBackup({
        heroes: snap.heroes,
        equipment: snap.equipment,
        skills: snap.skills,
        talents: snap.talents,
        talentBooks: snap.talentBooks,
        battlePresets: snap.battlePresets,
        savedSimulations: snap.savedSimulations,
      }));
    },

    importBackup: async (text, mode) => {
      const backup = parseBackup(text);
      if (mode === 'replace') {
        await adapter.replaceAll({
          heroes: backup.heroes,
          equipment: backup.equipment,
          skills: backup.skills,
          talents: backup.talents,
          talentBooks: backup.talentBooks,
          battlePresets: backup.battlePresets,
          savedSimulations: backup.savedSimulations,
        });
      } else {
        for (const h of backup.heroes) await adapter.saveHero(h);
        for (const e of backup.equipment) await adapter.saveEquipment(e);
        for (const s of backup.skills) await adapter.saveSkill(s);
        for (const t of backup.talents) await adapter.saveTalent(t);
        for (const b of backup.talentBooks) await adapter.saveTalentBook(b);
        for (const p of backup.battlePresets) await adapter.saveBattlePreset(p);
        for (const s of backup.savedSimulations) await adapter.saveSimulation(s);
      }
      await reloadAll();
    },

    reloadAll,
    clearError: () => set({ lastError: null }),
  };
});

export { MAX_EQUIPMENT };