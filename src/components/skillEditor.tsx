/**
 * 技能编辑器：名称 / 类型(主动·被动) / 参数 / 多段效果片段
 */
import type { Skill } from '../core/types';
import { NumberField, SelectField, ToggleField, SectionLabel } from './ui';
import { SegmentEditor, AddSegmentButton, defaultSegment } from './segmentEditor';

const TRIGGERS = [
  { value: 'on_basic_attack_hit', label: '普攻命中' },
  { value: 'on_attack', label: '攻击时' },
  { value: 'on_hit', label: '命中时' },
  { value: 'on_cast_skill', label: '释放技能' },
  { value: 'on_skill_hit', label: '技能命中' },
  { value: 'on_damage_dealt', label: '造成伤害' },
  { value: 'on_damage_taken', label: '受到伤害' },
  { value: 'on_hp_below', label: '生命低于%(自身)' },
  { value: 'on_combat_start', label: '战斗开始' },
  { value: 'on_interval', label: '固定间隔' },
  { value: 'on_kill', label: '击杀' },
  { value: 'on_shield_created', label: '获得护盾' },
  { value: 'on_shield_damaged', label: '护盾受到伤害' },
  { value: 'on_shield_broken', label: '护盾被击破' },
  { value: 'on_shield_expired', label: '护盾自然消失' },
];

export function SkillEditor({ value, onChange }: { value: Skill; onChange: (s: Skill) => void }) {
  const patch = (p: Partial<Skill>) => onChange({ ...value, ...p });

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{value.name || '技能'}</b>
        <button type="button" className="btn danger sm" onClick={() => onChange({ ...value, name: `技能 ${new Date().getTime() % 100000}` })}>重命名</button>
      </div>
      <div className="grid grid-3">
        <label className="field"><span>技能名称</span><input value={value.name} onChange={(e) => patch({ name: e.target.value })} /></label>
        <SelectField label="技能类型" value={value.type} options={[{ value: 'active', label: '主动' }, { value: 'passive', label: '被动' }]} onChange={(v) => patch({ type: v as 'active' | 'passive' })} />
      </div>

      {value.type === 'active' && (
        <>
          <SectionLabel>主动参数</SectionLabel>
          <div className="grid grid-3">
            <NumberField label="冷却(秒)" value={value.active?.cooldownSeconds ?? 5} step={0.5} min={0} onChange={(v) => patch({ active: { ...value.active!, cooldownSeconds: v } })} />
            <NumberField label="释放优先级" value={value.active?.priority ?? 1} step={1} min={0} onChange={(v) => patch({ active: { ...value.active!, priority: v } })} />
            <NumberField label="消耗" value={value.active?.manaCost ?? 0} step={5} min={0} onChange={(v) => patch({ active: { ...value.active!, manaCost: v } })} />
          </div>
        </>
      )}
      {value.type === 'passive' && (
        <>
          <SectionLabel>被动参数</SectionLabel>
          <div className="grid grid-3">
            <SelectField
              label="触发条件"
              value={value.passive?.trigger.kind ?? 'on_hit'}
              options={TRIGGERS}
              onChange={(kind) => patch({ passive: buildPassive(value.passive, kind) })}
            />
            <NumberField label="内部冷却(秒)" value={value.passive?.procCooldownSeconds ?? 0} step={0.5} min={0} onChange={(v) => patch({ passive: { ...(value.passive || { trigger: { kind: 'on_hit' } as const }), procCooldownSeconds: v } })} />
          </div>
        </>
      )}

      <SectionLabel>效果片段（多段按时间轴独立结算）</SectionLabel>
      {value.segments.map((seg, i) => (
        <SegmentEditor key={i} index={i} value={seg} onChange={(s) => {
          const next = [...value.segments]; next[i] = s; patch({ segments: next });
        }} onRemove={() => patch({ segments: value.segments.filter((_, j) => j !== i) })} />
      ))}
      <AddSegmentButton onAdd={(k) => patch({ segments: [...value.segments, defaultSegment(k)] })} />
    </div>
  );
}

function buildPassive(prev: Skill['passive'] | undefined, kindStr: string): NonNullable<Skill['passive']> {
  const cd = prev?.procCooldownSeconds ?? 0;
  if (kindStr === 'on_interval') {
    const every = prev?.trigger.kind === 'on_interval' && 'everySeconds' in prev.trigger ? prev.trigger.everySeconds : 1;
    return { trigger: { kind: 'on_interval', everySeconds: every }, procCooldownSeconds: cd };
  }
  const trigger = { kind: kindStr } as NonNullable<Skill['passive']>['trigger'];
  return { trigger, procCooldownSeconds: cd };
}