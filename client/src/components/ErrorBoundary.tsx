/**
 * Error Boundary Component
 * Catches React errors and provides fallback UI
 */

import { Component } from 'react';
import type { ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { logger } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

type ErrorVariant = 'generic' | 'staleAsset'

interface State {
  hasError: boolean;
  error?: Error;
  variant: ErrorVariant;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, variant: 'generic' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      variant: isStaleAssetError(error) ? 'staleAsset' : 'generic',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ErrorBoundary caught error:', error, errorInfo);
    
    // Report to Sentry error tracking
    Sentry.captureException(error, {
      extra: {
        componentStack: errorInfo.componentStack,
        variant: this.state.variant,
      },
    });
    
    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, variant: 'generic' });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      const fallback =
        this.state.variant === 'staleAsset'
          ? this.renderStaleAssetFallback()
          : this.renderGenericFallback();

      return fallback;
    }

    return this.props.children;
  }

  private renderGenericFallback() {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
              <svg
                className="w-8 h-8 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Something went wrong
            </h2>
            <p className="text-gray-600 mb-6">
              We're sorry, but something unexpected happened. Please try reloading the page.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <details className="text-left mb-6">
                <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                  Error details
                </summary>
                <pre className="mt-2 text-xs bg-gray-100 p-3 rounded overflow-auto max-h-40">
                  {this.state.error.message}
                  {this.state.error.stack && `\n\n${this.state.error.stack}`}
                </pre>
              </details>
            )}
          </div>
          <div className="space-y-3">
            <button
              onClick={this.handleReload}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Reload Page
            </button>
            <button
              onClick={this.handleReset}
              className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  private renderStaleAssetFallback() {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 mb-4">
              <svg
                className="w-8 h-8 text-indigo-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              HOCKIA has just been updated
            </h2>
            <p className="text-gray-600 mb-6">
              A new version of the app is available. Please reload the page to continue using HOCKIA.
            </p>
          </div>
          <button
            onClick={this.handleReload}
            className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Reload HOCKIA
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

function isStaleAssetError(error?: Error): boolean {
  if (!error) {
    return false;
  }

  const haystack = `${error.message ?? ''}\n${error.stack ?? ''}`.toLowerCase();
  const mentionsModuleFailure =
    haystack.includes('failed to fetch dynamically imported module') ||
    haystack.includes('failed to load module script');
  const mentionsMimeIssue =
    haystack.includes('mime type of "text/html"') ||
    haystack.includes("mime type of 'text/html'");
  const mentionsAssetsPath = haystack.includes('/assets/');

  return (mentionsModuleFailure || mentionsMimeIssue) && mentionsAssetsPath;
}

