/**
 * 设置：主题 + 数据备份（导出/导入）
 */
import { useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card, SelectField } from '../components/ui';

type Theme = 'light' | 'dark' | 'system';

export function Settings() {
  const { exportBackup, importBackup } = useAppStore();
  const [theme, setTheme] = useState<Theme>(localStorage.getItem('theme') as Theme || 'dark');
  const [mergeMode, setMergeMode] = useState<'merge' | 'replace'>('merge');
  const [msg, setMsg] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const applyTheme = (t: Theme) => {
    setTheme(t);
    localStorage.setItem('theme', t);
    const resolved = t === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
    document.documentElement.setAttribute('data-theme', resolved);
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      await importBackup(text, mergeMode);
      setMsg(`导入成功（${mergeMode === 'merge' ? '合并' : '覆盖'}），共导入备份内容。`);
    } catch (e) {
      setMsg('导入失败：' + (e as Error).message);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Card title="外观">
        <SelectField label="主题模式" value={theme} options={[
          { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' },
        ]} onChange={(v) => applyTheme(v as Theme)} />
      </Card>

      <Card title="数据备份">
        <div className="row">
          <button className="btn primary" onClick={exportBackup}>导出 JSON 备份</button>
        </div>
        <div className="section-label">导入 JSON 备份</div>
        <div className="row">
          <SelectField label="导入方式" value={mergeMode} options={[{ value: 'merge', label: '合并到现有数据' }, { value: 'replace', label: '覆盖全部数据' }]} onChange={(v) => setMergeMode(v as 'merge' | 'replace')} />
          <button className="btn" onClick={() => fileRef.current?.click()}>选择文件</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => onImportFile(e.target.files?.[0] ?? null)} />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>备份文件格式：moba-simulator-backup.json（含英雄/装备/技能/战斗方案/历史）。全部数据保存在本地 IndexedDB，账号云同步为后续阶段能力。</p>
        {msg && <p style={{ fontSize: 13 }}>{msg}</p>}
      </Card>
    </div>
  );
}