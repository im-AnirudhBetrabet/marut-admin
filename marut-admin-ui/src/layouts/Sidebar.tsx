import { NavLink } from "react-router-dom";
import { useAuth } from "../app/useAuth";
import {
  LayoutDashboard, ShoppingBag, Repeat2, Sprout, Wheat, Truck,
  Package, ReceiptText, Wallet, Receipt, BookOpen, MessageSquareText,
  ChartNoAxesCombined, Users, Settings, History, X, PanelLeftClose,
  PanelLeftOpen, LogOut,
} from "lucide-react";

type SidebarProps = {
  open            : boolean; 
  collapsed       : boolean; 
  onClose         : () => void;
  onToggleCollapse: () => void; 
  onLogout        : () => void;
};

const groups = [
  { label: "WORKSPACE", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  { label: "ORDERS", items: [
    { to: "/orders", label: "Orders", icon: ShoppingBag },
    { to: "/recurring-orders", label: "Recurring orders", icon: Repeat2 },
  ]},
  { label: "FARM OPERATIONS", items: [
    { to: "/production", label: "Production", icon: Sprout },
    { to: "/harvest", label: "Harvest", icon: Wheat },
    { to: "/fulfilment", label: "Fulfilment", icon: Truck },
  ]},
  { label: "COMMERCIAL", items: [
    { to: "/products", label: "Products", icon: Package },
    { to: "/invoices", label: "Invoices", icon: ReceiptText },
    { to: "/payments", label: "Payments", icon: Wallet },
    { to: "/expenses", label: "Expenses", icon: Receipt },
    { to: "/cashbook", label: "Cashbook", icon: BookOpen },
  ]},
  { label: "INSIGHTS", items: [
    { to: "/feedback", label: "Customer feedback", icon: MessageSquareText },
    { to: "/reports", label: "Reports", icon: ChartNoAxesCombined },
  ]},
  { label: "ADMINISTRATION", items: [
    { to: "/founders", label: "Founders", icon: Users },
    { to: "/settings", label: "Settings", icon: Settings },
    { to: "/audit", label: "Audit history", icon: History },
  ]},
];

export function Sidebar({ open, collapsed, onClose, onToggleCollapse, onLogout }: SidebarProps) {
  const { admin }    = useAuth();
  const displayName  = admin?.user?.display_name?.trim() || "Administrator";
  const initial      = displayName.charAt(0).toUpperCase();
  const canViewUsers = admin?.role === "owner" || (Array.isArray(admin?.permissions) && admin.permissions.some(
    (permission) => permission.module_key === "users" && (permission.level === "view" || permission.level === "manage"),
  ));

  return (
    <aside className={`sidebar${open ? " sidebar--open" : ""}${collapsed ? " sidebar--collapsed" : ""}`}>
      <div className="brand-row">
        <NavLink to="/dashboard" className="brand-mark" aria-label="MARUT Admin home">
          <img className="brand-logo brand-logo--light" src="/assets/marut-logo-dark.png" alt="MARUT" />
          <img className="brand-logo brand-logo--dark" src="/assets/marut-logo-gold.png" alt="" aria-hidden="true" />
        </NavLink>
        <div className="brand-copy">
          <span className="brand-name">MARUT</span>
          <span className="brand-caption">ADMINISTRATION</span>
        </div>
        <button className="icon-button sidebar-collapse" onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation">
          <X size={18} />
        </button>
      </div>

      <div className="workspace-switcher" title={displayName}>
        <span className="workspace-avatar" aria-hidden="true">{initial}</span>
        <span className="workspace-name">{displayName}</span>
        <span className="workspace-chevron" aria-hidden="true">⌄</span>
      </div>

      <nav className="side-nav" aria-label="Main navigation">
        {canViewUsers && <section className="nav-group">
          <h2 className="nav-group-label">ADMINISTRATION</h2>
          <NavLink to="/users" onClick={onClose} title="User management" aria-label="User management"
            className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}>
            <Users size={16} strokeWidth={1.8} /><span>User management</span>
          </NavLink>
        </section>}
        {groups.map((group) => (
          <section className="nav-group" key={group.label}>
            <h2 className="nav-group-label">{group.label}</h2>
            {group.items.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={onClose} title={label} aria-label={label}
                className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}>
                <Icon size={16} strokeWidth={1.8} /><span>{label}</span>
              </NavLink>
            ))}
          </section>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="sidebar-logout" type="button" onClick={onLogout} title="Sign out" aria-label="Sign out">
          <LogOut size={16} strokeWidth={1.8} /><span>Sign out</span>
        </button>
        <div className="environment-label"><span className="environment-dot" /> Workspace ready</div>
        <span className="sidebar-version">MARUT Admin · V2</span>
      </div>
    </aside>
  );
}
