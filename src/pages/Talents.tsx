/**
 * 天赋库：天赋模板 + 天赋页（组合）
 *
 *  - 天赋模板：创建/编辑/删除/复制（通用 + 英雄专属，全部基于 Trigger+Effect+Parameter）
 *  - 天赋页：将一组天赋保存为方案，战斗前选择并加载
 *  - 天赋效果完全复用技能/装备的效果系统（SegmentEditor），禁止写死逻辑
 */
import { useState } from 'react';
import type { Talent } from '../core/types';
import { useAppStore } from '../store/useAppStore';
import { Card, SectionLabel, TextField, SelectField } from '../components/ui';
import { TalentEditor } from '../components/talentEditor';
import { newTalent, newTalentBook, uid } from '../core/defaults';

export function Talents() {
  const {
    heroes, talents, talentBooks,
    upsertTalent, removeTalent, selectedTalentId, selectTalent,
    upsertTalentBook, removeTalentBook,
  } = useAppStore();

  const t = talents.find((x) => x.id === selectedTalentId) ?? talents[0] ?? null;
  const [bookId, setBookId] = useState<string>('');
  const book = talentBooks.find((b) => b.id === (bookId || undefined)) ?? talentBooks[0] ?? null;
  const bookTalents = (book?.talentIds || []).map((id) => talents.find((x) => x.id === id)).filter((x): x is Talent => !!x);

  const cloneTalent = (src: Talent) => {
    const c = JSON.parse(JSON.stringify(src)) as Talent;
    c.id = uid('talent'); c.name = src.name + ' 副本';
    upsertTalent(c); selectTalent(c.id);
  };

  const typeLabel = (type: string) => type === 'attribute' ? '属性' : type === 'passive' ? '被动' : type === 'conditional' ? '条件' : '触发';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,280px) 1fr', gap: 16, alignItems: 'start' }}>
      {/* 左：天赋模板列表 */}
      <div style={{ display: 'grid', gap: 16 }}>
        <Card title={`天赋 (${talents.length})`} actions={<button className="btn sm primary" onClick={() => { const n = newTalent(); upsertTalent(n); selectTalent(n.id); }}>+ 新建</button>}>
          <div style={{ maxHeight: '45vh', overflowY: 'auto' }}>
            {talents.map((x) => (
              <div key={x.id} className={`list-item ${x.id === t?.id ? 'active' : ''}`} onClick={() => selectTalent(x.id)}>
                <div className="grow">
                  <div>{x.name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{typeLabel(x.type)}{x.heroId ? ' · 专属' : ' · 通用'}</div>
                </div>
                <button className="btn sm ghost" onClick={(ev) => { ev.stopPropagation(); cloneTalent(x); }}>复制</button>
                <button className="btn sm ghost danger" onClick={(ev) => { ev.stopPropagation(); removeTalent(x.id); if (selectedTalentId === x.id) selectTalent(null); }}>删</button>
              </div>
            ))}
            {!talents.length && <p className="muted">暂无天赋模板。</p>}
          </div>
        </Card>

        {/* 天赋页（组合）管理 */}
        <Card title={`天赋页 (${talentBooks.length})`} actions={<button className="btn sm primary" onClick={() => { const n = newTalentBook(); if (t) n.talentIds = [t.id]; upsertTalentBook(n); setBookId(n.id); }}>+ 新建</button>}>
          {talentBooks.map((b) => (
            <div key={b.id} className={`list-item ${b.id === book?.id ? 'active' : ''}`} onClick={() => setBookId(b.id)}>
              <div className="grow">
                <div>{b.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{b.talentIds.length} 个天赋</div>
              </div>
              <button className="btn sm ghost danger" onClick={(ev) => { ev.stopPropagation(); removeTalentBook(b.id); }}>删</button>
            </div>
          ))}
          {!talentBooks.length && <p className="muted">暂无天赋页。可把一组天赋保存为方案，战斗前选择。</p>}
        </Card>
      </div>

      {/* 右：编辑器 */}
      <div style={{ display: 'grid', gap: 16 }}>
        {t ? <TalentEditor key={t.id} value={t} heroes={heroes} onChange={upsertTalent} /> : <Card><p className="muted">请先创建或选择一个天赋。</p></Card>}

        {book && (
          <Card title={`天赋页：${book.name}`}>
            <div className="grid grid-2">
              <TextField label="页名称" value={book.name} onChange={(v) => upsertTalentBook({ ...book, name: v })} />
              <TextField label="描述" value={book.description || ''} onChange={(v) => upsertTalentBook({ ...book, description: v })} />
            </div>
            <SectionLabel>已选天赋（点击下方天赋添加入页）</SectionLabel>
            {bookTalents.length ? (
              <div className="equip-slots" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {bookTalents.map((x, i) => (
                  <span key={x.id} className="badge" style={{ cursor: 'pointer' }}
                    onClick={() => upsertTalentBook({ ...book, talentIds: book.talentIds.filter((_, j) => j !== i) })}>
                    {x.name} ✕
                  </span>
                ))}
              </div>
            ) : <p className="muted">尚未选择天赋。</p>}
            <SectionLabel>添加天赋</SectionLabel>
            <SelectField label="天赋" value="" options={[
              { value: '', label: '选择天赋加入页面…' },
              ...talents.filter((x) => !book.talentIds.includes(x.id)).map((x) => ({ value: x.id, label: x.name })),
            ]} onChange={(v) => { if (v && !book.talentIds.includes(v)) upsertTalentBook({ ...book, talentIds: [...book.talentIds, v] }); }} />
          </Card>
        )}
      </div>
    </div>
  );
}