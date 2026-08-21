/**
 * 英雄库：列表 + 英雄编辑（属性 / 技能 / 默认装备）
 */
import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card, SectionLabel, SelectField } from '../components/ui';
import { HeroStatsEditor } from '../components/heroStatsEditor';
import { SkillEditor } from '../components/skillEditor';
import { uid, newHero, newSkill } from '../core/defaults';
import type { Hero } from '../core/types';

export function Heroes() {
  const { heroes, equipment, upsertHero, removeHero, selectedHeroId, selectHero } = useAppStore();
  const h = heroes.find((x) => x.id === selectedHeroId) ?? heroes[0] ?? null;
  const sorted = useMemo(() => [...heroes].sort((a, b) => a.name.localeCompare(b.name)), [heroes]);

  const cloneHero = (src: Hero) => {
    const c = JSON.parse(JSON.stringify(src)) as Hero;
    c.id = uid('hero'); c.name = src.name + ' 副本';
    upsertHero(c); selectHero(c.id);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 16, alignItems: 'start' }} className="hero-layout">
      <Card title={`英雄 (${heroes.length})`} actions={<button className="btn sm primary" onClick={() => { const n = newHero(); upsertHero(n); selectHero(n.id); }}>+ 新建</button>}>
        <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {sorted.map((x) => (
            <div key={x.id} className={`list-item ${x.id === h?.id ? 'active' : ''}`} onClick={() => selectHero(x.id)}>
              <div className="grow">{x.name}</div>
              <span className="badge">{x.type === 'melee' ? '近战' : '远程'}</span>
              <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); cloneHero(x); }}>复制</button>
              <button className="btn sm ghost danger" onClick={(e) => { e.stopPropagation(); removeHero(x.id); if (selectedHeroId === x.id) selectHero(null); }}>删</button>
            </div>
          ))}
          {!heroes.length && <p className="muted">还没有英雄，点击右上角「+ 新建」创建。</p>}
        </div>
      </Card>

      <div>
        {h ? (
          <HeroEditor key={h.id} hero={h} equipment={equipment} onSave={upsertHero} />
        ) : (
          <Card><p className="muted">请先创建或选择一个英雄。</p></Card>
        )}
      </div>
    </div>
  );
}

function HeroEditor({ hero, equipment, onSave }: { hero: Hero; equipment: Array<{ id: string; name: string }>; onSave: (h: Hero) => void }) {
  const patch = (p: Partial<Hero>) => onSave({ ...hero, ...p });

  return (
    <>
      <Card title="英雄信息" actions={<button className="btn primary" onClick={() => onSave(hero)}>保存</button>}>
        <div className="grid grid-3">
          <label className="field"><span>名称</span><input value={hero.name} onChange={(e) => patch({ name: e.target.value })} /></label>
          <SelectField label="类型" value={hero.type} options={[{ value: 'melee', label: '近战' }, { value: 'ranged', label: '远程' }]} onChange={(v) => patch({ type: v as 'melee' | 'ranged' })} />
        </div>
      </Card>

      <Card title="基础属性">
        <HeroStatsEditor stats={hero.baseStats} onChange={(s) => patch({ baseStats: s })} />
      </Card>

      <Card title="默认装备方案" className="eq-picker">
        <div className="equip-slots" style={{ display: 'flex', gap: 8 }}>
          {Array.from({ length: 9 }).map((_, i) => {
            const itemId = hero.defaultItems[i];
            const eq = itemId ? equipment.find((e) => e.id === itemId) : undefined;
            return (
              <div key={i} style={{ flex: '0 0 92px', border: '1px dashed var(--border)', borderRadius: 8, padding: 6, textAlign: 'center' }}>
                <div className="muted" style={{ fontSize: 11 }}>槽 {i + 1}</div>
                <select
                  value={eq?.id ?? ''}
                  onChange={(e) => {
                    const next = [...hero.defaultItems];
                    next[i] = e.target.value;
                    patch({ defaultItems: next.filter(Boolean).slice(0, 9) });
                  }}
                >
                  <option value="">（空）</option>
                  {equipment.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="技能" actions={<button className="btn sm primary" onClick={() => patch({ skills: [...hero.skills, newSkill()] })}>+ 添加技能</button>}>
        <div style={{ display: 'grid', gap: 12 }}>
          {hero.skills.map((s, i) => (
            <div key={s.id}>
              <SkillEditor value={s} onChange={(ns) => { const next = [...hero.skills]; next[i] = ns; patch({ skills: next }); }} />
            </div>
          ))}
          {!hero.skills.length && <p className="muted">暂无技能。英雄将只进行普通攻击。</p>}
        </div>
      </Card>
    </>
  );
}