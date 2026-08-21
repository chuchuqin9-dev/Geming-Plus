/**
 * 装备库：列表 + 装备编辑（属性加成 / 触发条件 / 内部冷却 / 参数化效果）
 */
import type { Equipment, EquipmentEffect, HeroStats } from '../core/types';
import { useAppStore } from '../store/useAppStore';
import { Card, NumberField, SectionLabel, SelectField, TextField } from '../components/ui';
import { SegmentEditor, AddSegmentButton, defaultSegment } from '../components/segmentEditor';
import { newEquipment, newEquipmentEffect, uid } from '../core/defaults';

const STAT_KEYS: Array<{ key: keyof HeroStats; label: string; type: 'num' | 'pct' | 'frac' }> = [
  { key: 'maxHp', label: '生命值', type: 'num' },
  { key: 'attack', label: '攻击力', type: 'num' },
  { key: 'ap', label: '法强', type: 'num' },
  { key: 'armor', label: '护甲', type: 'num' },
  { key: 'magicResist', label: '魔抗', type: 'num' },
  { key: 'cooldownReduction', label: '冷却缩减', type: 'pct' },
  { key: 'physicalVamp', label: '物理吸血', type: 'pct' },
  { key: 'magicVamp', label: '法术吸血', type: 'pct' },
  { key: 'allVamp', label: '全能吸血', type: 'pct' },
  { key: 'onHitHp', label: '击中恢复', type: 'pct' },
  { key: 'physicalCritRate', label: '物理暴击率', type: 'pct' },
  { key: 'physicalCritDamage', label: '物理爆伤', type: 'pct' },
  { key: 'magicCritRate', label: '魔法暴击率', type: 'pct' },
  { key: 'magicCritDamage', label: '魔法爆伤', type: 'pct' },
  { key: 'flatArmorPen', label: '护甲穿透', type: 'num' },
  { key: 'percentArmorPen', label: '比例护甲穿透', type: 'frac' },
  { key: 'flatMagicPen', label: '法术穿透', type: 'num' },
  { key: 'percentMagicPen', label: '比例法术穿透', type: 'frac' },
  { key: 'physicalSkillDamage', label: '物理技能增伤', type: 'pct' },
  { key: 'magicDamage', label: '法术增伤', type: 'pct' },
  { key: 'attackDamage', label: '普攻增伤', type: 'pct' },
  { key: 'damageReduction', label: '伤害减免', type: 'pct' },
  { key: 'shieldBonus', label: '护盾加成', type: 'pct' },
  { key: 'moveSpeed', label: '移速', type: 'num' },
  { key: 'attackInterval', label: '攻击间隔', type: 'num' },
];

const TRIGGER_OPTIONS = [
  { value: 'on_basic_attack_hit', label: '普攻命中' },
  { value: 'on_basic_attack_crit', label: '普攻暴击' },
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

export function EquipmentLibrary() {
  const { equipment, upsertEquipment, removeEquipment, selectedEqId, selectEq } = useAppStore();
  const e = equipment.find((x) => x.id === selectedEqId) ?? equipment[0] ?? null;
  const sorted = [...equipment].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,280px) 1fr', gap: 16, alignItems: 'start' }}>
      <Card title={`装备 (${equipment.length})`} actions={<button className="btn sm primary" onClick={() => { const n = newEquipment(); upsertEquipment(n); selectEq(n.id); }}>+ 新建</button>}>
        <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {sorted.map((x) => (
            <div key={x.id} className={`list-item ${x.id === e?.id ? 'active' : ''}`} onClick={() => selectEq(x.id)}>
              <div className="grow">{x.name}</div>
              {x.favorite && <span>★</span>}
              <button className="btn sm ghost" onClick={(ev) => { ev.stopPropagation(); const c = JSON.parse(JSON.stringify(x)) as Equipment; c.id = uid('eq'); c.name = x.name + ' 副本'; c.favorite = false; upsertEquipment(c); selectEq(c.id); }}>复制</button>
              <button className="btn sm ghost danger" onClick={(ev) => { ev.stopPropagation(); removeEquipment(x.id); if (selectedEqId === x.id) selectEq(null); }}>删</button>
            </div>
          ))}
        </div>
      </Card>
      <div>{e ? <EquipmentEditor key={e.id} eq={e} onSave={upsertEquipment} /> : <Card><p className="muted">请先创建或选择一个装备。</p></Card>}</div>
    </div>
  );
}

function EquipmentEditor({ eq, onSave }: { eq: Equipment; onSave: (e: Equipment) => void }) {
  const patch = (p: Partial<Equipment>) => onSave({ ...eq, ...p });
  const setStat = (key: keyof HeroStats, v: number) => {
    const next = { ...eq.stats };
    if (v === 0) delete next[key];
    else next[key] = v;
    patch({ stats: next });
  };

  return (
    <>
      <Card title="装备信息" actions={<button className="btn primary" onClick={() => onSave(eq)}>保存</button>}>
        <div className="grid grid-3">
          <TextField label="名称" value={eq.name} onChange={(v) => patch({ name: v })} />
          <TextField label="标签(逗号分隔)" value={eq.tags.join(',')} onChange={(v) => patch({ tags: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><span>收藏</span><input type="checkbox" checked={eq.favorite} onChange={(e) => patch({ favorite: e.target.checked })} /></label>
        </div>
      </Card>

      <Card title="属性加成">
        <div className="grid grid-3">
          {STAT_KEYS.map((f) => (
            <NumberField key={f.key} label={f.label} value={(eq.stats[f.key] ?? 0) as number} step={1} min={0} percent={f.type === 'pct'} frac={f.type === 'frac'} onChange={(v) => setStat(f.key, v)} />
          ))}
        </div>
      </Card>

      <Card title="参数化效果" actions={<button className="btn sm primary" onClick={() => patch({ effects: [...eq.effects, newEquipmentEffect()] })}>+ 添加效果</button>}>
        <div style={{ display: 'grid', gap: 12 }}>
          {eq.effects.map((ef, i) => (
            <EquipmentEffectEditor key={ef.id} effect={ef} onChange={(n) => { const next = [...eq.effects]; next[i] = n; patch({ effects: next }); }} onRemove={() => patch({ effects: eq.effects.filter((_, j) => j !== i) })} />
          ))}
          {!eq.effects.length && <p className="muted">暂无效果。该装备仅提供属性加成。</p>}
        </div>
      </Card>
    </>
  );
}

function EquipmentEffectEditor({ effect, onChange, onRemove }: { effect: EquipmentEffect; onChange: (e: EquipmentEffect) => void; onRemove: () => void }) {
  const patch = (p: Partial<EquipmentEffect>) => onChange({ ...effect, ...p });
  const trig = effect.trigger;

  const updateTrigger = (kind: string) => {
    let t: EquipmentEffect['trigger'] = { kind: 'on_basic_attack_hit' } as EquipmentEffect['trigger'];
    if (kind === 'on_interval') t = { kind: 'on_interval', everySeconds: 1 };
    else if (kind === 'on_hp_below') t = { kind: 'on_hp_below', hpBelowPercent: 20 };
    else if (kind === 'on_skill_hit' || kind === 'on_damage_dealt') t = { kind } as EquipmentEffect['trigger'];
    else t = { kind } as EquipmentEffect['trigger'];
    patch({ trigger: t });
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <TextField label="效果名" value={effect.name} onChange={(v) => patch({ name: v })} />
        <button type="button" className="btn sm danger" onClick={onRemove}>移除效果</button>
      </div>
      <div className="grid grid-3">
        <SelectField label="触发条件" value={trig.kind} options={TRIGGER_OPTIONS} onChange={updateTrigger} />
        {trig.kind === 'on_interval' && 'everySeconds' in trig && (
          <NumberField label="间隔(秒)" value={trig.everySeconds} step={0.5} min={0.1} onChange={(v) => patch({ trigger: { kind: 'on_interval', everySeconds: v } })} />
        )}
        {trig.kind === 'on_hp_below' && 'hpBelowPercent' in trig && (
          <NumberField label="低于生命%" value={trig.hpBelowPercent} step={5} min={1} max={100} onChange={(v) => patch({ trigger: { kind: 'on_hp_below', hpBelowPercent: v } })} />
        )}
        {(trig.kind === 'on_skill_hit' || trig.kind === 'on_damage_dealt') && (
          <SelectField label="伤害类型过滤" value={'damageType' in trig && trig.damageType ? trig.damageType : 'any'} options={[
            { value: 'any', label: '任意' }, { value: 'physical', label: '物理' }, { value: 'magic', label: '魔法' }, { value: 'true', label: '真实' },
          ]} onChange={(v) => patch({ trigger: { ...trig, damageType: v === 'any' ? undefined : v } as EquipmentEffect['trigger'] })} />
        )}
      </div>
      <div className="row">
        <NumberField label="内部冷却(秒)" value={effect.limit?.seconds ?? 0} step={0.5} min={0} onChange={(v) => patch({ limit: v > 0 ? { type: 'cooldown', seconds: v } : undefined })} />
        <span className="muted" style={{ fontSize: 12 }}>0 = 无冷却</span>
      </div>
      <SectionLabel>效果段</SectionLabel>
      {effect.segments.map((seg, i) => (
        <SegmentEditor key={i} index={i} value={seg} onChange={(n) => { const next = [...effect.segments]; next[i] = n; patch({ segments: next }); }} onRemove={() => patch({ segments: effect.segments.filter((_, j) => j !== i) })} />
      ))}
      <AddSegmentButton onAdd={(k) => patch({ segments: [...effect.segments, defaultSegment(k)] })} />
    </div>
  );
}