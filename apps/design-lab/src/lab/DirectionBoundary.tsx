import { Component, type ErrorInfo, type ReactNode } from "react";
import { markError } from "./ready";

interface Props {
  readonly name: string;
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

/**
 * Catches a direction that throws while rendering, so a half-finished direction shows its error
 * inside the window instead of a blank page, and the shoot script fails fast with the message.
 */
export class DirectionBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    markError(`${this.props.name}: ${error.message}`);
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="lab-crash" role="alert">
        <p className="lab-crash-title">{this.props.name} crashed while rendering</p>
        <pre className="lab-crash-message">{error.stack ?? error.message}</pre>
      </div>
    );
  }
}
