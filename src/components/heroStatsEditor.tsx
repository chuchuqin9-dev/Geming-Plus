/**
 * 英雄基础属性编辑器。
 * 属性分组成「生存/攻击/暴击/穿透/战斗/资源(保留)」多张卡片，逐字段数字输入。
 */
import type { HeroStats } from '../core/types';
import { NumberField, SectionLabel } from './ui';

interface F {
  key: keyof HeroStats;
  label: string;
  type: 'num' | 'pct' | 'frac';
  step?: number;
  min?: number;
}

const GROUPS: Array<{ name: string; fields: F[] }> = [
  {
    name: '生存属性',
    fields: [
      { key: 'maxHp', label: '最大生命值', type: 'num', step: 100, min: 0 },
      { key: 'armor', label: '护甲', type: 'num', step: 10, min: 0 },
      { key: 'magicResist', label: '魔抗', type: 'num', step: 10, min: 0 },
    ],
  },
  {
    name: '攻击属性',
    fields: [
      { key: 'attack', label: '攻击力', type: 'num', step: 10, min: 0 },
      { key: 'ap', label: '法强', type: 'num', step: 10, min: 0 },
      { key: 'moveSpeed', label: '移动速度', type: 'num', step: 10, min: 0 },
      { key: 'attackInterval', label: '攻击间隔(秒)', type: 'num', step: 0.05, min: 0.01 },
      { key: 'attackRange', label: '攻击距离(预留)', type: 'num', step: 1, min: 0 },
    ],
  },
  {
    name: '物理暴击',
    fields: [
      { key: 'physicalCritRate', label: '物理暴击率', type: 'pct', step: 1, min: 0 },
      { key: 'physicalCritDamage', label: '物理暴击伤害', type: 'pct', step: 5, min: 100 },
    ],
  },
  {
    name: '魔法暴击',
    fields: [
      { key: 'magicCritRate', label: '魔法暴击率', type: 'pct', step: 1, min: 0 },
      { key: 'magicCritDamage', label: '魔法暴击伤害', type: 'pct', step: 5, min: 100 },
    ],
  },
  {
    name: '穿透',
    fields: [
      { key: 'flatArmorPen', label: '固定护甲穿透', type: 'num', step: 5, min: 0 },
      { key: 'percentArmorPen', label: '百分比护甲穿透', type: 'frac', step: 0.05, min: 0 },
      { key: 'flatMagicPen', label: '固定法术穿透', type: 'num', step: 5, min: 0 },
      { key: 'percentMagicPen', label: '百分比法术穿透', type: 'frac', step: 0.05, min: 0 },
    ],
  },
  {
    name: '战斗属性',
    fields: [
      { key: 'cooldownReduction', label: '冷却缩减', type: 'pct', step: 1, min: 0 },
      { key: 'physicalSkillDamage', label: '物理技能增伤', type: 'pct', step: 1, min: 0 },
      { key: 'attackDamage', label: '普攻增伤', type: 'pct', step: 1, min: 0 },
      { key: 'magicDamage', label: '法术增伤', type: 'pct', step: 1, min: 0 },
      { key: 'damageReduction', label: '伤害减免', type: 'pct', step: 1, min: 0 },
      { key: 'shieldBonus', label: '护盾加成', type: 'pct', step: 1, min: 0 },
    ],
  },
  {
    name: '吸血',
    fields: [
      { key: 'physicalVamp', label: '物理吸血', type: 'pct', step: 1, min: 0 },
      { key: 'magicVamp', label: '法术吸血', type: 'pct', step: 1, min: 0 },
      { key: 'allVamp', label: '全能吸血', type: 'pct', step: 1, min: 0 },
      { key: 'onHitHp', label: '击中恢复', type: 'pct', step: 1, min: 0 },
    ],
  },
];

export function HeroStatsEditor({ stats, onChange }: { stats: HeroStats; onChange: (s: HeroStats) => void }) {
  const setField = (key: keyof HeroStats, v: number) => onChange({ ...stats, [key]: v });
  return (
    <div>
      {GROUPS.map((g) => (
        <div key={g.name}>
          <SectionLabel>{g.name}</SectionLabel>
          <div className="grid grid-3">
            {g.fields.map((f) => (
              <NumberField
                key={f.key}
                label={f.label}
                value={stats[f.key] as number}
                step={f.step}
                min={f.min}
                percent={f.type === 'pct'}
                frac={f.type === 'frac'}
                onChange={(v) => setField(f.key, v)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}