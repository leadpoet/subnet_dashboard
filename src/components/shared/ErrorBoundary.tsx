'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface Props {
  /** Optional label included in error logging. Useful when several boundaries exist. */
  label?: string
  /** Optional custom fallback. Receives the captured error and a reset function. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Component-level error boundary.
 *
 * Catches errors from any descendant React component during render, in
 * lifecycle methods, or in constructors of the whole tree. Renders a
 * graceful fallback UI with a "Try again" button (`reset()` clears the
 * error and re-renders children).
 *
 * Errors in event handlers, async code, or SSR are NOT caught by React
 * boundaries; those still need explicit try/catch.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const label = this.props.label || 'ErrorBoundary'
    // Keep console logging. Useful in dev and for production telemetry pipelines.
    console.error(`[${label}] component crashed:`, error, info)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset)
    }

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center bg-slate-900/50 border border-burgundy-soft rounded-xl"
      >
        <div className="flex items-center gap-2 text-burgundy">
          <AlertCircle className="h-5 w-5" aria-hidden />
          <span className="font-semibold text-sm">Something went wrong</span>
        </div>
        <p className="text-xs text-slate-400 font-mono max-w-xl break-words">
          {error.message || 'An unexpected error occurred while rendering this section.'}
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-200 bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60 hover:border-slate-600 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--brand)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Try again
        </button>
      </div>
    )
  }
}
