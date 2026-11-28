import { Component, type ReactNode } from 'react';

/**
 * Keeps one broken part of a page from blanking the whole dashboard. Recorded data comes from anyone
 * holding the public key, so a malformed event must only break the part that shows it.
 */
export class ErrorBoundary extends Component<{ what: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  render() {
    if (this.state.error) {
      return (
        <p className="error small">
          The {this.props.what} couldn't be shown: {this.state.error}. The rest of the session is below.
        </p>
      );
    }
    return this.props.children;
  }
}
