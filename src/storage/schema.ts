/**
 * 数据版本控制与迁移
 *
 * 所有持久化 / 导入导出的模板 JSON 均携带 schemaVersion。
 * 未来数据结构变更时，在 MIGRATE 数组中按 (from -> to +1) 注册迁移函数，
 * 保证旧数据可无损升级，避免「改了结构旧模板就废了」。
 */
import {
  type AnyTemplate, type BackupFile, type BattlePreset, type Equipment,
  type Hero, type SavedSimulation, type Skill, type Talent, type TalentBook,
  SCHEMA_VERSION,
} from '../core/types';
import { uid } from '../core/defaults';

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION;

/** 简单结构化复制，防止迁移时共享引用 */
function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

interface Migration {
  from: number;
  run: (data: unknown) => unknown;
}

/** 已注册迁移：索引 = from 版本，run 将 from 版本升级到 from+1 */
const MIGRATIONS: Migration[] = [];

/** 将任意旧版本数据迁移到最新 schemaVersion（无法识别则原样返回） */
export function migrateToCurrent(data: unknown, version: number): { version: number; data: unknown } {
  let v = typeof version === 'number' && Number.isFinite(version) ? version : 1;
  let out = clone(data);
  for (let i = 0; i < 64 && v < CURRENT_SCHEMA_VERSION; i++) {
    const m = MIGRATIONS[v];
    if (!m) break; // 无该步迁移则停止，保留已迁移到的版本
    out = m.run(out);
    v = m.from + 1;
  }
  return { version: Math.min(v, CURRENT_SCHEMA_VERSION), data: out };
}

// 向后兼容：为缺失 id 的项补充 id
function ensureIds(data: unknown, kind: 'hero' | 'equipment' | 'skill' | 'talent' | 'talentBook' | 'preset' | 'sim'): unknown {
  const arr = (data as Array<{ id?: string }>) || [];
  let counter = 0;
  return arr.map((item) => {
    if (item && !item.id) {
      const base = kind === 'hero' ? 'h' : kind === 'equipment' ? 'e' : kind === 'skill' ? 's' : kind === 'talent' ? 't' : kind === 'talentBook' ? 'tb' : kind === 'preset' ? 'p' : 'sim';
      return { ...item, id: uid(`${base}${counter++}`) };
    }
    return item;
  });
}

/**
 * 将备份文件归一化到当前 schema：版本迁移 + 补 id + 剔除空余字段风险。
 * 返回 undefined 表示不是合法备份。
 */
export function normalizeBackup(raw: { schemaVersion?: number } & Partial<BackupFile>): BackupFile {
  const version = raw?.schemaVersion ?? 1;
  let src: Partial<BackupFile> & { exportedAt?: string };
  try {
    // 先整体做版本迁移（未来字段改名等）
    src = migrateToCurrent(raw, version).data as Partial<BackupFile>;
  } catch {
    // 迁移失败退化为浅拷贝，避免直接丢弃用户数据
    src = clone(raw);
  }
  return {
    kind: 'moba-simulator-backup',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: (src.exportedAt as string) || new Date().toISOString(),
    heroes: ensureIds(src.heroes || [], 'hero') as Hero[],
    equipment: ensureIds(src.equipment || [], 'equipment') as Equipment[],
    skills: ensureIds(src.skills || [], 'skill') as Skill[],
    talents: ensureIds(src.talents || [], 'talent') as Talent[],
    talentBooks: ensureIds(src.talentBooks || [], 'talentBook') as TalentBook[],
    battlePresets: ensureIds(src.battlePresets || [], 'preset') as BattlePreset[],
    savedSimulations: ensureIds(src.savedSimulations || [], 'sim') as SavedSimulation[],
  };
}

/** 校验 JSON 是否是可识别的备份文件 */
export function isBackupFile(x: unknown): x is BackupFile {
  return !!x && typeof x === 'object' && (x as BackupFile).kind === 'moba-simulator-backup';
}

/** 包装单个模板（带 schemaVersion），供多模板导入使用 */
export function wrapTemplate(data: Hero | Equipment | Skill | Talent | TalentBook | BattlePreset): AnyTemplate {
  const kind =
    'baseStats' in data && 'skills' in data ? 'hero'
      : 'effects' in data && 'stats' in data && !('trigger' in data) ? 'equipment'
        : 'segments' in data ? 'skill'
          : 'effects' in data && 'heroId' in data ? 'talent'
            : 'talentIds' in data ? 'talentBook' : 'battle';
  return { kind, schemaVersion: CURRENT_SCHEMA_VERSION, data } as AnyTemplate;
}