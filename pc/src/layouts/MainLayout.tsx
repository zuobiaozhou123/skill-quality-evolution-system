import {
  Archive,
  Boxes,
  FileCheck2,
  FlaskConical,
  Gauge,
  Inbox,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { to: "/", label: "治理总览", icon: Gauge },
  { to: "/bad-cases", label: "Bad Case", icon: Inbox },
  { to: "/evidence", label: "Evidence", icon: FileCheck2 },
  { to: "/skills", label: "Skill 资产", icon: Boxes },
  { to: "/proposals", label: "变更提案", icon: FlaskConical },
  { to: "/releases", label: "发布中心", icon: Archive },
];

export function MainLayout({ content }: { content?: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="brand-mark">SG</span>
          <div>
            <strong>Skill Governance</strong>
            <span>LOCAL CONTROL PLANE</span>
          </div>
        </div>
        <nav className="side-nav" aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink className={({ isActive }) => (isActive ? "active" : "")} end={to === "/"} key={to} to={to}>
              <Icon aria-hidden size={17} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          <span>本地模式</span>
        </div>
      </aside>
      <main className="main-content">{content ?? <Outlet />}</main>
    </div>
  );
}
