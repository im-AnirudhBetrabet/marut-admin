import { ArrowUpRight, Sprout } from "lucide-react";

export function DashboardPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MARUT OPERATIONS</p>
          <h1>Good day.</h1>
          <p className="page-description">Your operations overview will take shape here.</p>
        </div>
        <span className="page-context">Workspace overview</span>
      </div>
      <section className="welcome-panel">
        <div className="welcome-icon"><Sprout size={22} /></div>
        <div className="welcome-copy">
          <span className="panel-kicker">FOUNDATION READY</span>
          <h2>The workspace is ready to grow.</h2>
          <p>This is the starting point for MARUT Admin V2. We'll introduce live operational data and workflows one capability at a time.</p>
        </div>
        <ArrowUpRight className="welcome-arrow" size={19} />
      </section>
      <section className="section-heading">
        <div>
          <h2>Overview</h2>
          <p>Operational metrics will appear here once the dashboard functionality is implemented.</p>
        </div>
      </section>
      <div className="metric-grid">
        {["Orders", "Production", "Payments", "Feedback"].map((item) => (
          <article className="metric-card" key={item}>
            <span className="metric-label">{item}</span>
            <span className="metric-placeholder">—</span>
            <span className="metric-note">Not connected yet</span>
          </article>
        ))}
      </div>
      <section className="empty-panel">
        <div className="empty-mark"><Sprout size={20} /></div>
        <h3>Your dashboard starts here</h3>
        <p>No sample figures or simulated business data have been added. We'll connect this page to the approved backend API when we implement the dashboard.</p>
      </section>
    </div>
  );
}
