/**
 * 技能库：可复用的技能模板（英雄编辑时可引用）
 */
import type { Skill } from '../core/types';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui';
import { SkillEditor } from '../components/skillEditor';
import { newSkill, uid } from '../core/defaults';

export function Skills() {
  const { skills, upsertSkill, removeSkill, selectedSkillId, selectSkill } = useAppStore();
  const s = skills.find((x) => x.id === selectedSkillId) ?? skills[0] ?? null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,240px) 1fr', gap: 16, alignItems: 'start' }}>
      <Card title={`技能 (${skills.length})`} actions={<button className="btn sm primary" onClick={() => { const n = newSkill(); upsertSkill(n); selectSkill(n.id); }}>+ 新建</button>}>
        {skills.map((x) => (
          <div key={x.id} className={`list-item ${x.id === s?.id ? 'active' : ''}`} onClick={() => selectSkill(x.id)}>
            <div className="grow">{x.name}</div>
            <span className="badge">{x.type === 'active' ? '主动' : '被动'}</span>
            <button className="btn sm ghost" onClick={(ev) => { ev.stopPropagation(); const c = JSON.parse(JSON.stringify(x)) as Skill; c.id = uid('skill'); c.name = x.name + ' 副本'; upsertSkill(c); selectSkill(c.id); }}>复制</button>
            <button className="btn sm ghost danger" onClick={(ev) => { ev.stopPropagation(); removeSkill(x.id); if (selectedSkillId === x.id) selectSkill(null); }}>删</button>
          </div>
        ))}
        {!skills.length && <p className="muted">暂无技能模板。</p>}
      </Card>
      <div>
        {s ? <SkillEditor key={s.id} value={s} onChange={upsertSkill} /> : <Card><p className="muted">技能模板用于收藏可复用的技能，可手动配置到英雄。</p></Card>}
      </div>
    </div>
  );
}