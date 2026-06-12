import { Component } from "react";

// Top-level error boundary: a render error anywhere below would otherwise unmount
// the whole React tree and leave a blank white page. This catches it, shows a
// recoverable fallback, and logs the error (console.error is mirrored to the
// /debug error log in main.jsx). Error boundaries must be class components.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error?.stack || error, info?.componentStack || "");
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-950 text-gray-100 p-6 text-center">
          <div className="text-3xl" aria-hidden="true">⚠️</div>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-gray-400">
            The app hit an unexpected error. Reloading usually fixes it — if it keeps happening, please let us know.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
