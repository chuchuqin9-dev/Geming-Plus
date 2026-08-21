/**
 * 效果片段编辑器：一段伤害/Dot/治疗/护盾的编辑，含参数化倍率(stat × ratio)。
 * 技能与装备效果共用，避免重复。
 */
import type { CooldownReduceSegment, DamageSegment, DotSegment, EffectSegment, HealSegment, ShieldSegment, StatKey, StatScaling } from '../core/types';
import { damageSegmentFactory, cooldownReduceSegmentFactory, shieldSegmentFactory } from '../core/defaults';
import { NumberField, SelectField, ToggleField, SectionLabel } from './ui';

const STAT_OPTIONS: Array<{ value: StatKey; label: string }> = [
  { value: 'maxHp', label: '自身最大生命' },
  { value: 'currentHp', label: '自身当前生命' },
  { value: 'lostHp', label: '自身已损失生命' },
  { value: 'attack', label: '自身攻击力' },
  { value: 'extraAttack', label: '自身额外攻击力' },
  { value: 'ap', label: '自身法强' },
  { value: 'armor', label: '自身护甲' },
  { value: 'magicResist', label: '自身魔抗' },
  { value: 'targetMaxHp', label: '目标最大生命' },
  { value: 'targetCurrentHp', label: '目标当前生命' },
  { value: 'targetLostHp', label: '目标已损失生命' },
  { value: 'targetAttack', label: '目标攻击力' },
  { value: 'targetAp', label: '目标法强' },
];

const DAMAGE_TYPES = [
  { value: 'raw', label: '原始伤害' },
  { value: 'physical', label: '物理伤害' },
  { value: 'magic', label: '魔法伤害' },
  { value: 'true', label: '真实伤害' },
];

const SHIELD_TYPES = [
  { value: 'all', label: '全类型护盾' },
  { value: 'physical', label: '物理护盾' },
  { value: 'magic', label: '魔法护盾' },
];

const SHIELD_REFRESH = [
  { value: 'overwrite', label: '覆盖（旧护盾消失）' },
  { value: 'stack', label: '叠加（累加数值）' },
  { value: 'max', label: '取最大值' },
  { value: 'extend', label: '延长时间' },
];

const COOLDOWN_TARGET = [
  { value: 'SELF_SKILL', label: '当前技能' },
  { value: 'OTHER_SKILLS', label: '其他技能' },
  { value: 'ALL_SKILLS', label: '所有技能' },
];

export function ScalingRows({ scaling, onChange }: { scaling: StatScaling[]; onChange: (s: StatScaling[]) => void }) {
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>属性倍率</span>
        <button type="button" className="btn sm" onClick={() => onChange([...scaling, { stat: 'attack', ratio: 0 }])}>+ 添加倍率</button>
      </div>
      {scaling.map((s, i) => (
        <div key={i} className="row" style={{ marginBottom: 4, alignItems: 'end' }}>
          <SelectField label="属性来源" value={s.stat} options={STAT_OPTIONS} onChange={(v) => {
            const next = [...scaling]; next[i] = { ...s, stat: v as StatKey }; onChange(next);
          }} />
          <NumberField label="倍率%" value={s.ratio * 100} step={5} min={0} onChange={(v) => {
            const next = [...scaling]; next[i] = { ...s, ratio: v / 100 }; onChange(next);
          }} />
          <button type="button" className="btn sm danger" onClick={() => onChange(scaling.filter((_, j) => j !== i))}>删</button>
        </div>
      ))}
    </div>
  );
}

export function SegmentEditor({ value, onChange, onRemove, index }: { value: EffectSegment; onChange: (s: EffectSegment) => void; onRemove: () => void; index: number }) {
  const set = (patch: Partial<EffectSegment>) => onChange({ ...value, ...patch } as EffectSegment);

  if (value.kind === 'heal') {
    const v = value as HealSegment;
    return (
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>治疗段 {index + 1}</b>
          <button type="button" className="btn sm danger" onClick={onRemove}>移除</button>
        </div>
        <div className="grid grid-3">
          <NumberField label="延迟(秒)" value={v.delaySeconds} step={0.1} min={0} onChange={(x) => set({ delaySeconds: x })} />
          <NumberField label="基础治疗量" value={v.basePower} step={5} min={0} onChange={(x) => set({ basePower: x })} />
        </div>
        <SectionLabel>倍率</SectionLabel>
        <ScalingRows scaling={v.scaling} onChange={(x) => set({ scaling: x })} />
      </div>
    );
  }

  if (value.kind === 'shield') {
    const v = value as ShieldSegment;
    return (
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>护盾段 {index + 1}</b>
          <button type="button" className="btn sm danger" onClick={onRemove}>移除</button>
        </div>
        <div className="grid grid-3">
          <NumberField label="延迟(秒)" value={v.delaySeconds} step={0.1} min={0} onChange={(x) => set({ delaySeconds: x })} />
          <NumberField label="基础护盾量" value={v.basePower} step={5} min={0} onChange={(x) => set({ basePower: x })} />
          <NumberField label="持续(秒)" value={v.durationSeconds} step={1} min={0} onChange={(x) => set({ durationSeconds: x })} />
        </div>
        <div className="grid grid-3">
          <SelectField label="护盾类型" value={v.shieldType} options={SHIELD_TYPES} onChange={(x) => set({ shieldType: x as ShieldSegment['shieldType'] })} />
          <SelectField label="刷新规则" value={v.refresh} options={SHIELD_REFRESH} onChange={(x) => set({ refresh: x as ShieldSegment['refresh'] })} />
          <NumberField label="吸收优先级" value={v.priority} step={1} min={0} onChange={(x) => set({ priority: x })} />
        </div>
        <SectionLabel>倍率</SectionLabel>
        <ScalingRows scaling={v.scaling} onChange={(x) => set({ scaling: x })} />
      </div>
    );
  }

  if (value.kind === 'cooldown_reduce') {
    const v = value as CooldownReduceSegment;
    return (
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>冷却减少段 {index + 1}</b>
          <button type="button" className="btn sm danger" onClick={onRemove}>移除</button>
        </div>
        <div className="grid grid-3">
          <NumberField label="延迟(秒)" value={v.delaySeconds} step={0.1} min={0} onChange={(x) => set({ delaySeconds: x })} />
          <NumberField label="减少冷却(秒)" value={v.seconds} step={0.5} min={0} onChange={(x) => set({ seconds: x })} />
          <SelectField label="技能范围" value={v.target} options={COOLDOWN_TARGET} onChange={(x) => set({ target: x as CooldownReduceSegment['target'] })} />
        </div>
        <div className="row">
          <ToggleField label="可超过当前剩余冷却" checked={v.allowOvershoot} onChange={(x) => set({ allowOvershoot: x })} />
        </div>
      </div>
    );
  }

  if (value.kind === 'dot') {
    const v = value as DotSegment;
    return (
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>持续伤害段 {index + 1}</b>
          <button type="button" className="btn sm danger" onClick={onRemove}>移除</button>
        </div>
        <div className="grid grid-3">
          <NumberField label="首跳延迟(秒)" value={v.delaySeconds} step={0.1} min={0} onChange={(x) => set({ delaySeconds: x })} />
          <NumberField label="总持续(秒)" value={v.totalSeconds} step={0.5} min={0.1} onChange={(x) => set({ totalSeconds: x })} />
          <NumberField label="跳跃间隔(秒)" value={v.tickSeconds} step={0.2} min={0.1} onChange={(x) => set({ tickSeconds: x })} />
        </div>
        <div className="grid grid-3">
          <NumberField label="每跳基础伤害" value={v.baseDamagePerTick} step={5} min={0} onChange={(x) => set({ baseDamagePerTick: x })} />
          <SelectField label="伤害类型" value={v.damageType} options={DAMAGE_TYPES} onChange={(x) => set({ damageType: x as DotSegment['damageType'] })} />
        </div>
        <div className="row">
          <ToggleField label="可暴击" checked={v.canCrit} onChange={(x) => set({ canCrit: x })} />
          <ToggleField label="触发装备" checked={v.canTriggerItems} onChange={(x) => set({ canTriggerItems: x })} />
        </div>
        <SectionLabel>倍率</SectionLabel>
        <ScalingRows scaling={v.scaling} onChange={(x) => set({ scaling: x })} />
      </div>
    );
  }

  const v = value as DamageSegment;
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>伤害段 {index + 1}</b>
        <button type="button" className="btn sm danger" onClick={onRemove}>移除</button>
      </div>
      <div className="grid grid-3">
        <NumberField label="延迟(秒)" value={v.delaySeconds} step={0.1} min={0} onChange={(x) => set({ delaySeconds: x })} />
        <NumberField label="基础伤害" value={v.baseDamage} step={5} min={0} onChange={(x) => set({ baseDamage: x })} />
        <SelectField label="伤害类型" value={v.damageType} options={DAMAGE_TYPES} onChange={(x) => set({ damageType: x as DamageSegment['damageType'] })} />
      </div>
      <div className="grid grid-3">
        <SelectField label="暴击归属" value={v.critFamily} options={[{ value: 'physical', label: '物理暴击' }, { value: 'magic', label: '魔法暴击' }]} onChange={(x) => set({ critFamily: x as 'physical' | 'magic' })} />
        <SelectField label="伤害来源" value={v.sourceKind} options={[
          { value: 'basic_attack', label: '普攻' }, { value: 'skill', label: '技能' }, { value: 'item', label: '装备' }, { value: 'dot', label: '持续' },
        ]} onChange={(x) => set({ sourceKind: x as DamageSegment['sourceKind'] })} />
        <SelectField label="增伤类型" value={v.isSkillBoost ? 'skill' : v.isBasicAttackBoost ? 'basic' : 'none'} options={[
          { value: 'skill', label: '吃技能增伤' }, { value: 'basic', label: '吃普攻增伤' }, { value: 'none', label: '不吃增伤' },
        ]} onChange={(x) => set({ isSkillBoost: x === 'skill', isBasicAttackBoost: x === 'basic' })} />
      </div>
      <div className="row">
        <ToggleField label="可暴击" checked={v.canCrit} onChange={(x) => set({ canCrit: x })} />
        <ToggleField label="触发吸血" checked={v.canLifesteal} onChange={(x) => set({ canLifesteal: x })} />
        <ToggleField label="触发装备" checked={v.canTriggerItems} onChange={(x) => set({ canTriggerItems: x })} />
        <ToggleField label="全能吸血" checked={v.useAllVamp ?? true} onChange={(x) => set({ useAllVamp: x })} />
        {v.damageType === 'magic' && (
          <ToggleField label="法术增伤" checked={v.useMagicDamageBoost ?? true} onChange={(x) => set({ useMagicDamageBoost: x })} />
        )}
      </div>
      <SectionLabel>倍率</SectionLabel>
      <ScalingRows scaling={v.scaling} onChange={(x) => set({ scaling: x })} />
    </div>
  );
}

/** 默认一段效果片段（可按类型创建） */
export function defaultSegment(kind: EffectSegment['kind'] = 'damage'): EffectSegment {
  switch (kind) {
    case 'shield': return shieldSegmentFactory(200, 0);
    case 'cooldown_reduce': return cooldownReduceSegmentFactory(1, 'ALL_SKILLS');
    case 'heal': return { kind: 'heal', delaySeconds: 0, basePower: 100, scaling: [] };
    case 'dot': return { kind: 'dot', delaySeconds: 0, totalSeconds: 3, tickSeconds: 1, baseDamagePerTick: 30, scaling: [], damageType: 'magic', canCrit: false, critFamily: 'physical', canTriggerItems: true, useAllVamp: true };
    default: return damageSegmentFactory(80, 'physical');
  }
}

export const SEGMENT_KINDS: Array<{ value: EffectSegment['kind']; label: string }> = [
  { value: 'damage', label: '伤害' },
  { value: 'dot', label: '持续伤害' },
  { value: 'heal', label: '治疗' },
  { value: 'shield', label: '护盾' },
  { value: 'cooldown_reduce', label: '冷却减少' },
];

/** 「添加效果段」按钮：先选类型 */
export function AddSegmentButton({ onAdd }: { onAdd: (kind: EffectSegment['kind']) => void }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <span className="muted" style={{ fontSize: 12 }}>+ 添加效果段：</span>
      {SEGMENT_KINDS.map((k) => (
        <button type="button" key={k.value} className="btn sm" onClick={() => onAdd(k.value)}>{k.label}</button>
      ))}
    </div>
  );
}