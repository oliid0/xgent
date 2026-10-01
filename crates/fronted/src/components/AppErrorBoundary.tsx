import { Component, type ErrorInfo, type ReactNode } from "react";
import { finishLaunch } from "../lib/system/launchScreen";
import { AppErrorFallback, type AppErrorRecoveryOptions } from "./AppErrorFallback";

type ErrorBoundaryProps = AppErrorRecoveryOptions & { children: ReactNode };
type ErrorBoundaryState = { error: Error | null; componentStack: string };

export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    finishLaunch(false);
    console.error("[AppErrorBoundary]", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <AppErrorFallback
        error={this.state.error}
        componentStack={this.state.componentStack}
        mode={this.props.mode}
        appearance={this.props.appearance}
        nativeMobile={this.props.nativeMobile}
        onClose={this.props.onClose}
      />
    );
  }
}
