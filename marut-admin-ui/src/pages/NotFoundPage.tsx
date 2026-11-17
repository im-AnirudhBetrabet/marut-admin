import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="not-found">
      <span className="eyebrow">404 · PAGE NOT FOUND</span>
      <h1>This page isn't here.</h1>
      <p>The address may have changed, or the page may not exist.</p>
      <Link className="primary-link" to="/dashboard">Return to dashboard</Link>
    </div>
  );
}
