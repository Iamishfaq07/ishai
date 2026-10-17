import { Component, type ErrorInfo, type ReactNode } from "react";
import { cx, focusRing } from "./cx";
import { buttonClass } from "./ui";

interface Props {
  children: ReactNode;
  /** Custom fallback; receives a reset() that clears the error and re-renders children. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Called on catch — hook for Sentry/telemetry. */
  onError?: (error: Error, info: ErrorInfo) => void;
}
interface State {
  error: Error | null;
}

/** Stops a single render error from blanking the whole app (esp. mid-interview). */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Orbit render error:", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Something went wrong.</p>
        <p className="max-w-sm text-xs text-zinc-500">{error.message || "An unexpected error occurred."}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.reset}
            className={cx("rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-800", focusRing)}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={buttonClass("primary")}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
