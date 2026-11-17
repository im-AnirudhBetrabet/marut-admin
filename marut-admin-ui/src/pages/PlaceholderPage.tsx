type PlaceholderPageProps = { title: string };

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MARUT ADMINISTRATION</p>
          <h1>{title}</h1>
          <p className="page-description">This module has not been implemented yet.</p>
        </div>
      </div>
      <section className="empty-panel empty-panel--page">
        <h3>{title} workspace</h3>
        <p>The page route and application shell are in place. Functionality, data contracts and permissions will be added in a dedicated implementation step.</p>
        <span className="coming-soon">FOUNDATION ONLY</span>
      </section>
    </div>
  );
}
