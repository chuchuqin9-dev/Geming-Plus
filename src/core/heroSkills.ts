/**
 * 英雄技能引用（skillId）的解析 / 归一化 / 迁移
 *
 * 数据模型约定：
 *  - 英雄数据 Hero.skills 只存「技能库」中技能的 id（skillId 引用），不复制技能定义。
 *  - 技能定义统一放在技能库（Skill[]），英雄战斗时按 skillId 关联解析。
 *  - 兼容旧数据：老版本英雄可能把完整 Skill 对象内嵌进 hero.skills，加载时迁移为引用。
 */
import type { EffectSegment, Hero, Skill } from './types';

/** 判断英雄技能字段是否为旧的「内嵌完整技能对象」格式 */
export function isEmbeddedSkillField(skills: unknown): skills is Skill[] {
  return Array.isArray(skills) && skills.length > 0
    ? skills.every(
        (s) =>
          !!s &&
          typeof s === 'object' &&
          typeof (s as Skill).id === 'string' &&
          'segments' in (s as Skill) &&
          Array.isArray((s as Skill).segments),
      )
    : false;
}

/**
 * 由英雄 skills（id 数组）从技能库解析出完整技能列表（顺序保持），
 * 跳过引用缺失（已被删除）的技能 id。
 * 兼容旧数据：若 hero.skills 仍为内嵌 Skill 对象（历史战斗预设快照），则直接以其为定义解析。
 */
export function resolveHeroSkills(hero: Pick<Hero, 'skills'> | null | undefined, library: Skill[]): Skill[] {
  const byId = new Map<string, Skill>();
  for (const s of library) byId.set(s.id, s);
  const raw = (hero as { skills?: unknown } | null | undefined)?.skills;
  let ids: string[];
  if (isEmbeddedSkillField(raw)) {
    // 历史内嵌对象：以其自身为定义（无需依赖技能库）
    ids = raw.map((s) => {
      if (!byId.has(s.id)) byId.set(s.id, s);
      return s.id;
    });
  } else {
    ids = Array.isArray(raw) ? (raw as string[]) : [];
  }
  const out: Skill[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (s) out.push(s);
  }
  return out;
}

/** 保留技能库中真实存在的 skillId，剔除失效引用（返回新的有序 id 数组） */
export function normalizeHeroSkillIds(hero: Pick<Hero, 'skills'> | null | undefined, library: Skill[]): string[] {
  const byId = new Set(library.map((s) => s.id));
  const ids = Array.isArray(hero?.skills) ? (hero.skills as string[]) : [];
  return ids.filter((id) => byId.has(id));
}

/**
 * 迁移英雄技能字段并同步技能库：
 *  - 若 hero.skills 是内嵌 Skill 对象（旧格式），将其并入技能库（按 id 去重），并把 hero.skills 替换为其 id 顺序引用。
 *  - 若已是 id 数组，仅剔除失效引用（保证后续引擎解析不断链）。
 * 返回迁移后的英雄列表与（可能被扩充的）技能库。
 */
export function migrateHeroSkillRefs(
  heroes: Hero[],
  library: Skill[],
): { heroes: Hero[]; library: Skill[] } {
  const lib = [...library];
  const libById = new Map<string, Skill>();
  for (const s of lib) libById.set(s.id, s);

  const migratedHeroes = heroes.map((h) => {
    const raw = (h as { skills?: unknown }).skills;
    if (isEmbeddedSkillField(raw)) {
      const ids: string[] = [];
      for (const sk of raw) {
        const existing = libById.get(sk.id);
        if (existing) {
          // 技能库已存在同 id 技能：保留库中定义（库为准）
          if (!ids.includes(sk.id)) ids.push(sk.id);
        } else {
          libById.set(sk.id, sk);
          lib.push(sk);
          ids.push(sk.id);
        }
      }
      return { ...h, skills: ids };
    }
    // 已是 id 数组：剔除失效引用
    const ids = (h.skills as string[]).filter((id) => libById.has(id));
    return { ...h, skills: ids };
  });

  return { heroes: migratedHeroes, library: lib };
}

/** 由效果片段生成一段可读的简要描述（技能卡片展示用，非持久化字段） */
export function describeSkillSegments(segments: EffectSegment[] | undefined): string {
  if (!segments || segments.length === 0) return '无效果';
  const parts: string[] = [];
  for (const seg of segments) {
    switch (seg.kind) {
      case 'damage':
        parts.push((seg.baseDamage ? `造成 ${seg.baseDamage}` : '') + (seg.damageType === 'true' ? ' 真实伤害' : seg.damageType === 'physical' ? ' 物理伤害' : ' 魔法伤害'));
        break;
      case 'dot':
        parts.push(`持续伤害 ${seg.totalSeconds}s`);
        break;
      case 'heal':
        parts.push(`治疗 ${seg.basePower}`);
        break;
      case 'shield':
        parts.push(`护盾 ${seg.basePower}`);
        break;
      case 'cooldown_reduce':
        parts.push(`冷却-${seg.seconds}s`);
        break;
      case 'buff':
        parts.push(`${seg.buffType} 效果`);
        break;
      case 'on_hit_damage':
        parts.push(`On-hit 伤害 ${seg.baseDamage}`);
        break;
      default:
        break;
    }
  }
  return parts.length ? parts.join('、') : '无效果';
}