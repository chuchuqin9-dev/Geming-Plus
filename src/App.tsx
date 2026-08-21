import { NavLink, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { Heroes } from './pages/Heroes';
import { EquipmentLibrary } from './pages/Equipment';
import { Skills } from './pages/Skills';
import { Talents } from './pages/Talents';
import { Combat } from './pages/Combat';
import { Compare } from './pages/Compare';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { useAppStore } from './store/useAppStore';

const NAV = [
  { to: '/', label: '首页' },
  { to: '/heroes', label: '英雄库' },
  { to: '/equipment', label: '装备库' },
  { to: '/skills', label: '技能库' },
  { to: '/talents', label: '天赋库' },
  { to: '/combat', label: '战斗模拟' },
  { to: '/compare', label: '方案对比' },
  { to: '/history', label: '历史记录' },
  { to: '/settings', label: '设置' },
];

export default function App() {
  const lastError = useAppStore((s) => s.lastError);
  const clearError = useAppStore((s) => s.clearError);
  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">MOBA 数值实验室</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        {lastError && (
          <div className="banner-error">
            <span>⚠ {lastError}</span>
            <button className="btn sm" onClick={clearError}>关闭</button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/heroes" element={<Heroes />} />
          <Route path="/equipment" element={<EquipmentLibrary />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/talents" element={<Talents />} />
          <Route path="/combat" element={<Combat />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </div>
  );
}