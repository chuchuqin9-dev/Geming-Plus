/**
 * 首页：功能总览 + 数据规模
 */
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { Card } from '../components/ui';

export function Home() {
  const { heroes, equipment, skills, savedSimulations } = useAppStore();
  const cards = [
    { to: '/heroes', title: '英雄库', desc: '创建、编辑英雄属性与技能', count: heroes.length },
    { to: '/equipment', title: '装备库', desc: '属性 + 参数化触发效果', count: equipment.length },
    { to: '/skills', title: '技能库', desc: '可复用技能模板', count: skills.length },
    { to: '/combat', title: '战斗模拟', desc: '打木桩 / 英雄 VS 英雄', count: null },
    { to: '/compare', title: '方案对比', desc: '对比两套方案差异', count: null },
    { to: '/history', title: '历史记录', desc: '已保存的模拟结果', count: savedSimulations.length },
  ];
  return (
    <div style={{ maxWidth: 1000 }}>
      <Card>
        <h2 style={{ margin: 0 }}>MOBA 数值实验室</h2>
        <p className="muted" style={{ marginBottom: 4 }}>
          基于「时间轴 + 战斗事件」驱动的 MOBA 数值模拟分析：英雄属性 / 装备搭配 / DPS / 爆发 / 生存 / 方案对比。
        </p>
        <p className="muted" style={{ fontSize: 13 }}>优先级：计算准确 &gt; 规则清晰 &gt; 结果可复现 &gt; 架构可扩展。数据保存在本地（IndexedDB），支持 JSON 导入导出。</p>
      </Card>
      <div className="grid grid-3">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card className="list-card" title={c.title}>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>{c.desc}</p>
              {c.count !== null && <b className="mono">{c.count} 项</b>}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}