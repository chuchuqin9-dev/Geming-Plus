/**
 * 英雄库：列表 + 英雄编辑（属性 / 技能 / 默认装备）
 *
 * 技能管理采用「技能库引用」模型：英雄只保存技能库中的 skillId，
 * 实际技能由技能库经 skillId 关联解析。支持搜索选择、防重、排序、删除（带确认）。
 */
import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card, SectionLabel, SelectField } from '../components/ui';
import { HeroStatsEditor } from '../components/heroStatsEditor';
import { uid, newHero } from '../core/defaults';
import { describeSkillSegments, resolveHeroSkills } from '../core/heroSkills';
import type { Hero, Skill } from '../core/types';

export function Heroes() {
  const { heroes, equipment, skills, upsertHero, removeHero, selectedHeroId, selectHero } = useAppStore();
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
          <HeroEditor key={h.id} hero={h} equipment={equipment} skills={skills} onSave={upsertHero} />
        ) : (
          <Card><p className="muted">请先创建或选择一个英雄。</p></Card>
        )}
      </div>
    </div>
  );
}

function HeroEditor({ hero, equipment, skills, onSave }: { hero: Hero; equipment: Array<{ id: string; name: string }>; skills: Skill[]; onSave: (h: Hero) => void }) {
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

      <SkillManager hero={hero} skills={skills} onChange={(ids) => patch({ skills: ids })} />
    </>
  );
}

/** 英雄技能配置：技能库选择 + 已选技能列表（排序 / 删除 / 确认） */
function SkillManager({ hero, skills, onChange }: { hero: Hero; skills: Skill[]; onChange: (ids: string[]) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const selectedIds = hero.skills ?? [];
  const resolved = useMemo(() => resolveHeroSkills(hero, skills), [hero, skills]);
  const selectedMap = useMemo(() => new Set(selectedIds), [selectedIds]);

  const addSkill = (id: string) => {
    // 防止重复添加同一个技能
    if (selectedMap.has(id)) return;
    onChange([...selectedIds, id]);
  };
  const removeSkill = (id: string) => {
    setConfirmId(null);
    onChange(selectedIds.filter((x) => x !== id));
  };
  const move = (i: number, dir: -1 | 1) => {
    const next = [...selectedIds];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  // 技能库选择数据源：可直接读写技能库，且与英雄已选联动
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (q && !(s.name.toLowerCase().includes(q) || (s.type === 'active' ? '主动' : '被动').includes(q))) return false;
      return true;
    });
  }, [skills, search]);

  return (
    <Card title={`技能 (${resolved.length})`} actions={<button className="btn sm primary" onClick={() => setPickerOpen(true)}>+ 添加技能</button>}>
      {/* 已选技能列表（卡片式） */}
      {resolved.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {resolved.map((s, i) => (
            <div key={s.id} className="skill-card-row">
              <div className="row" style={{ flex: 1, gap: 8, alignItems: 'center' }}>
                <span className="badge">{i + 1}</span>
                <span className={`badge ${s.type === 'passive' ? 'badge-passive' : ''}`}>{s.type === 'active' ? '主动' : '被动'}</span>
                <div className="skill-head" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{describeSkillSegments(s.segments)}</div>
                </div>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn sm ghost" title="上移" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="btn sm ghost" title="下移" onClick={() => move(i, 1)} disabled={i === resolved.length - 1}>↓</button>
                <button className="btn sm ghost danger" title="删除技能" onClick={() => setConfirmId(s.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">暂无技能。点击「+ 添加技能」从技能库中选择。英雄将只进行普通攻击。</p>
      )}

      {/* 删除确认 + 技能选择弹窗 */}
      {confirmId && (
        <div className="modal-backdrop" onClick={() => setConfirmId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除技能</h3>
            <p>确定将该技能从英雄技能栏移除吗？技能库中的定义不会被删除。</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmId(null)}>取消</button>
              <button className="btn danger" onClick={() => removeSkill(confirmId)}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {pickerOpen && (
        <div className="modal-backdrop" onClick={() => { setPickerOpen(false); setSearch(''); }}>
          <div className="modal skill-picker" onClick={(e) => e.stopPropagation()}>
            <h3>选择技能</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <input placeholder="搜索技能名称 / 主动 / 被动" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>
            {skills.length === 0 ? (
              <p className="muted">技能库为空，请先到「技能库」创建技能模板，再回来选择。</p>
            ) : filtered.length === 0 ? (
              <p className="muted">没有匹配的技能。</p>
            ) : (
              <div className="skill-picker-grid">
                {filtered.map((s) => {
                  const added = selectedMap.has(s.id);
                  return (
                    <div key={s.id} className={`skill-pick-card ${added ? 'selected' : ''}`} onClick={() => { if (!added) addSkill(s.id); }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                        <span className={`badge ${s.type === 'passive' ? 'badge-passive' : ''}`}>{s.type === 'active' ? '主动' : '被动'}</span>
                        {added && <span className="badge badge-added">已选择</span>}
                      </div>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{describeSkillSegments(s.segments)}</div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => { setPickerOpen(false); setSearch(''); }}>完成</button>
            </div>
          </div>
        </div>
      )}

      <SectionLabel>技能库 {skills.length ? `（共 ${skills.length} 个可选）` : '为空'}</SectionLabel>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        英雄技能通过 skillId 关联技能库，复用已创建的技能模板，避免数据重复。修改技能库中的技能会自动同步到引用它的英雄。
      </p>
    </Card>
  );
}