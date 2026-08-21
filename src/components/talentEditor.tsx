/**
 * 天赋编辑器：名称 / 描述 / 类型 / 英雄绑定 / 属性加成 / 触发条件 + 参数化效果段
 *
 * 天赋效果完全复用「Trigger + Effect + Parameter」机制（SegmentEditor 统一渲染），
 * 不会针对任一天赋写死逻辑。
 */
import type { HeroStats, Talent, TalentType, TriggerConditionKind, TriggerEvent } from '../core/types';
import { NumberField, SelectField, SectionLabel, TextField } from './ui';
import { SegmentEditor, AddSegmentButton, defaultSegment } from './segmentEditor';

const TALENT_TYPES: Array<{ value: TalentType; label: string }> = [
  { value: 'attribute', label: '属性型（直接加成）' },
  { value: 'passive', label: '被动型' },
  { value: 'triggered', label: '触发型' },
  { value: 'conditional', label: '条件型' },
];

/** 触发事件（统一枚举） */
const TRIGGER_EVENTS: Array<{ value: TriggerEvent; label: string }> = [
  { value: 'combat_start', label: '战斗开始' },
  { value: 'cast_skill', label: '释放技能' },
  { value: 'skill_hit', label: '技能命中' },
  { value: 'basic_attack_hit', label: '普通攻击命中' },
  { value: 'basic_attack_crit', label: '普通攻击暴击' },
  { value: 'damage_dealt', label: '造成伤害' },
  { value: 'damage_taken', label: '受到伤害' },
  { value: 'kill', label: '击杀目标' },
  { value: 'hp_below', label: '生命值低于' },
  { value: 'interval', label: '固定间隔' },
  { value: 'shield_created', label: '获得护盾' },
  { value: 'shield_damaged', label: '护盾受到伤害' },
  { value: 'shield_broken', label: '护盾被击破' },
  { value: 'shield_expired', label: '护盾自然消失' },
];

/** 属性加成可编辑字段 */
const STAT_FIELDS: Array<{ key: keyof HeroStats; label: string; pct?: boolean }> = [
  { key: 'maxHp', label: '最大生命值' },
  { key: 'attack', label: '攻击力' },
  { key: 'ap', label: '法强' },
  { key: 'armor', label: '护甲' },
  { key: 'magicResist', label: '魔抗' },
  { key: 'moveSpeed', label: '移速' },
  { key: 'physicalCritRate', label: '物理暴击率', pct: true },
  { key: 'physicalCritDamage', label: '物理爆伤', pct: true },
  { key: 'magicCritRate', label: '魔法暴击率', pct: true },
  { key: 'magicCritDamage', label: '魔法爆伤', pct: true },
  { key: 'flatArmorPen', label: '护甲穿透' },
  { key: 'flatMagicPen', label: '法术穿透' },
  { key: 'physicalSkillDamage', label: '物理技能增伤', pct: true },
  { key: 'magicDamage', label: '法术增伤', pct: true },
  { key: 'attackDamage', label: '普攻增伤', pct: true },
  { key: 'damageReduction', label: '伤害减免', pct: true },
  { key: 'shieldBonus', label: '护盾加成', pct: true },
  { key: 'cooldownReduction', label: '冷却缩减', pct: true },
];

export function TalentEditor({ value, heroes, onChange, onRename }: {
  value: Talent;
  heroes: Array<{ id: string; name: string }>;
  onChange: (t: Talent) => void;
  onRename?: () => void;
}) {
  const patch = (p: Partial<Talent>) => onChange({ ...value, ...p });
  const isAttribute = value.type === 'attribute';

  const setStat = (key: keyof HeroStats, v: number) => {
    const next = { ...(value.statBonus || {}) } as Partial<HeroStats>;
    if (v === 0) delete next[key];
    else (next[key] as number) = v;
    patch({ statBonus: next });
  };

  const setEvent = (event: string) => {
    // 保留已有条件；切换事件时按需重建条件默认值
    const trigger = value.trigger || { event: 'combat_start' as TriggerEvent };
    let condition: TriggerConditionKind | undefined = trigger.condition;
    if (event === 'hp_below' && (!condition || condition.type !== 'hpBelow')) condition = { type: 'hpBelow', hpBelowPercent: 30 };
    else if (event === 'interval' && (!condition || condition.type !== 'every')) condition = { type: 'every', everySeconds: 1 };
    else if (event !== 'hp_below' && event !== 'interval' && condition && condition.type !== 'damageType') condition = undefined;
    patch({ trigger: { event: event as TriggerEvent, condition } });
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <b>{value.name}</b>
        {onRename && <button className="btn sm danger" onClick={onRename}>重命名</button>}
      </div>
      <div className="grid grid-3">
        <TextField label="名称" value={value.name} onChange={(v) => patch({ name: v })} />
        <TextField label="描述" value={value.description} onChange={(v) => patch({ description: v })} />
        <SelectField label="类型" value={value.type} options={TALENT_TYPES} onChange={(v) => patch({ type: v as TalentType })} />
      </div>
      <div className="grid grid-3">
        <SelectField label="英雄绑定" value={value.heroId ?? ''} options={[{ value: '', label: '通用（所有英雄可选）' }, ...heroes.map((h) => ({ value: h.id, label: `专属：${h.name}` }))]} onChange={(v) => patch({ heroId: v || null })} />
        <TextField label="图标名（可选）" value={value.icon || ''} onChange={(v) => patch({ icon: v })} />
      </div>

      {isAttribute ? (
        <>
          <SectionLabel>属性加成（战斗开始时合并进面板）</SectionLabel>
          <div className="grid grid-3">
            {STAT_FIELDS.map((f) => (
              <NumberField key={f.key} label={f.label} value={(value.statBonus?.[f.key] ?? 0) as number} step={1} min={0} percent={f.pct} onChange={(v) => setStat(f.key, v)} />
            ))}
          </div>
        </>
      ) : (
        <>
          <SectionLabel>触发条件</SectionLabel>
          <div className="grid grid-3">
            <SelectField label="触发事件" value={value.trigger?.event ?? 'combat_start'} options={TRIGGER_EVENTS} onChange={setEvent} />
            {value.trigger?.condition?.type === 'hpBelow' && (
              <NumberField label="低于生命%" value={value.trigger.condition.hpBelowPercent} step={5} min={1} max={100} onChange={(v) => patch({ trigger: { ...value.trigger!, condition: { type: 'hpBelow', hpBelowPercent: v } } })} />
            )}
            {value.trigger?.condition?.type === 'every' && (
              <NumberField label="间隔(秒)" value={value.trigger.condition.everySeconds} step={0.5} min={0.1} onChange={(v) => patch({ trigger: { ...value.trigger!, condition: { type: 'every', everySeconds: v } } })} />
            )}
            {(value.trigger?.event === 'damage_dealt' || value.trigger?.event === 'skill_hit' || value.trigger?.event === 'damage_taken') && (
              <SelectField label="伤害类型过滤" value={value.trigger?.condition?.type === 'damageType' ? (value.trigger.condition as { damageType: string }).damageType : 'any'} options={[
                { value: 'any', label: '任意' }, { value: 'physical', label: '物理' }, { value: 'magic', label: '魔法' }, { value: 'true', label: '真实' },
              ]} onChange={(v) => patch({ trigger: { ...value.trigger!, condition: v === 'any' ? undefined : { type: 'damageType', damageType: v } as unknown as TriggerConditionKind } })} />
            )}
          </div>
          <SectionLabel>效果段（复用技能/装备效果系统）</SectionLabel>
          {(value.effects || []).map((seg, i) => (
            <SegmentEditor key={i} index={i} value={seg} onChange={(s) => { const next = [...(value.effects || [])]; next[i] = s; patch({ effects: next }); }} onRemove={() => patch({ effects: (value.effects || []).filter((_, j) => j !== i) })} />
          ))}
          <AddSegmentButton onAdd={(k) => patch({ effects: [...(value.effects || []), defaultSegment(k)] })} />
        </>
      )}
    </div>
  );
}