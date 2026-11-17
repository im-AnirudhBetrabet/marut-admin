import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Replace with the approved observability provider.
    console.error("Application rendering error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="fatal-error">
          <span className="eyebrow">MARUT ADMIN</span>
          <h1>Something went wrong.</h1>
          <p>The application couldn't render this screen. Please refresh and try again.</p>
          <button className="primary-button" onClick={() => window.location.reload()}>Refresh application</button>
        </main>
      );
    }
    return this.props.children;
  }
}
