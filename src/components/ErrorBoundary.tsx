import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export function deriveErrorState(): State {
  return { hasError: true };
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return deriveErrorState();
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard crashed:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary__content">
            <span className="error-boundary__brand">Wx CFO Scorecard</span>
            <h2 className="error-boundary__headline">Something went wrong</h2>
            <p className="error-boundary__subline">
              The dashboard hit an unexpected error. Reloading usually clears it.
            </p>
            <button
              type="button"
              className="error-boundary__btn"
              onClick={this.handleReload}
            >
              Reload dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
