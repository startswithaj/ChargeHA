import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// The page behind remains visible — similar to Next.js error overlay.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, errorInfo: null };

  private handleDismiss = () => {
    this.setState({ error: null, errorInfo: null });
  };

  private handleRetry = () => {
    this.setState({ error: null, errorInfo: null });
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error(
      `[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`,
      error,
      errorInfo,
    );
  }

  override render() {
    const { error, errorInfo } = this.state;
    const { label } = this.props;

    return (
      <>
        {this.props.children}
        {error && (
          <div className={styles.overlay}>
            <div className={styles.modal}>
              <div className={styles.header}>
                <span className={styles.icon}>⚠</span>
                <span className={styles.title}>
                  {label ? `Error in ${label}` : "Something went wrong"}
                </span>
                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={this.handleDismiss}
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
              <div className={styles.message}>{error.message}</div>
              {errorInfo?.componentStack && (
                <pre className={styles.stack}>
                  {errorInfo.componentStack.trim()}
                </pre>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.retryButton}
                  onClick={this.handleRetry}
                >
                  Try again
                </button>
                <button
                  type="button"
                  className={styles.dismissButton}
                  onClick={this.handleDismiss}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
}
