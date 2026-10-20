/**
 * Performance Monitoring
 * Tracks API performance and user experience metrics
 */

import { logger } from './logger'

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  success: boolean;
  error?: string;
  tags?: Record<string, string>;
}

interface ErrorReport {
  message: string;
  stack?: string;
  timestamp: number;
  context?: Record<string, unknown>;
  userAgent?: string;
  url?: string;
  userId?: string;
}

interface PerformanceStats {
  count: number;
  successRate: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private errors: ErrorReport[] = [];
  private readonly MAX_METRICS = 1000;
  private readonly MAX_ERRORS = 100;
  private readonly SLOW_THRESHOLD = 1000; // 1 second

  /**
   * Measure the performance of an async operation
   */
  async measure<T>(name: string, fn: () => Promise<T>, tags?: Record<string, string>): Promise<T> {
    const start = performance.now();
    const timestamp = Date.now();

    try {
      const result = await fn();
      const duration = performance.now() - start;

      this.recordMetric({
        name,
        duration,
        timestamp,
        success: true,
        tags,
      });

      // Warn on slow operations
      if (duration > this.SLOW_THRESHOLD) {
        console.warn(
          `⚠️ Slow operation: ${name} took ${duration.toFixed(2)}ms`,
          tags ? `[${JSON.stringify(tags)}]` : ''
        );
      }

      return result;
    } catch (error) {
      const duration = performance.now() - start;

      this.recordMetric({
        name,
        duration,
        timestamp,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        tags,
      });

      throw error;
    }
  }

  /**
   * Record a metric manually
   */
  recordMetric(metric: PerformanceMetric) {
    this.metrics.push(metric);

    // Keep only recent metrics
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.shift();
    }
  }

  /**
   * Get performance statistics for an operation
   */
  getStats(operationName?: string): PerformanceStats | null {
    const filtered = operationName
      ? this.metrics.filter((m) => m.name === operationName)
      : this.metrics;

    if (filtered.length === 0) return null;

    const durations = filtered.map((m) => m.duration).sort((a, b) => a - b);
    const successCount = filtered.filter((m) => m.success).length;

    return {
      count: filtered.length,
      successRate: (successCount / filtered.length) * 100,
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      min: durations[0],
      p50: durations[Math.floor(durations.length * 0.5)],
      p95: durations[Math.floor(durations.length * 0.95)],
      p99: durations[Math.floor(durations.length * 0.99)],
      max: durations[durations.length - 1],
    };
  }

  /**
   * Get all operation names that have been measured
   */
  getOperations(): string[] {
    return [...new Set(this.metrics.map((m) => m.name))];
  }

  /**
   * Get recent slow operations
   */
  getSlowOperations(threshold = this.SLOW_THRESHOLD, limit = 10): PerformanceMetric[] {
    return this.metrics
      .filter((m) => m.duration > threshold)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  /**
   * Get recent failures
   */
  getFailures(limit = 10): PerformanceMetric[] {
    return this.metrics
      .filter((m) => !m.success)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Log performance statistics to console
   */
  logStats(operationName?: string) {
    const stats = this.getStats(operationName);
    if (!stats) {
      console.log('No metrics available');
      return;
    }

    console.group(`📊 Performance Stats${operationName ? ` - ${operationName}` : ''}`);
    console.table({
      'Total Operations': stats.count,
      'Success Rate': `${stats.successRate.toFixed(2)}%`,
      'Average': `${stats.avg.toFixed(2)}ms`,
      'Median (p50)': `${stats.p50.toFixed(2)}ms`,
      'p95': `${stats.p95.toFixed(2)}ms`,
      'p99': `${stats.p99.toFixed(2)}ms`,
      'Min': `${stats.min.toFixed(2)}ms`,
      'Max': `${stats.max.toFixed(2)}ms`,
    });
    console.groupEnd();
  }

  /**
   * Log all operations
   */
  logAllStats() {
    const operations = this.getOperations();
    console.group('📊 All Performance Stats');
    
    operations.forEach((op) => {
      const stats = this.getStats(op);
      if (stats) {
        console.log(`\n${op}:`);
        console.table({
          Count: stats.count,
          'Success %': stats.successRate.toFixed(1),
          'Avg ms': stats.avg.toFixed(2),
          'p95 ms': stats.p95.toFixed(2),
        });
      }
    });
    
    console.groupEnd();
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics = [];
  }

  /**
   * Get health status based on recent metrics
   */
  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    p95Latency: number;
    errorRate: number;
    slowOperations: number;
  } {
    const recentMetrics = this.metrics.slice(-100); // Last 100 operations
    if (recentMetrics.length === 0) {
      return {
        status: 'healthy',
        p95Latency: 0,
        errorRate: 0,
        slowOperations: 0,
      };
    }

    const durations = recentMetrics.map((m) => m.duration).sort((a, b) => a - b);
    const p95Latency = durations[Math.floor(durations.length * 0.95)] || 0;
    const errorRate = (recentMetrics.filter((m) => !m.success).length / recentMetrics.length) * 100;
    const slowOperations = recentMetrics.filter((m) => m.duration > this.SLOW_THRESHOLD).length;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (p95Latency > 2000 || errorRate > 5) {
      status = 'unhealthy';
    } else if (p95Latency > 1000 || errorRate > 2) {
      status = 'degraded';
    }

    return {
      status,
      p95Latency,
      errorRate,
      slowOperations,
    };
  }

  /**
   * Track an error with context
   */
  trackError(error: Error | string, context?: Record<string, unknown>, userId?: string) {
    const errorReport: ErrorReport = {
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: Date.now(),
      context,
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      userId,
    };

    this.errors.push(errorReport);

    // Keep only recent errors
    if (this.errors.length > this.MAX_ERRORS) {
      this.errors.shift();
    }

    // Log error
    logger.error('Error tracked:', {
      message: errorReport.message,
      context,
      userId,
      url: errorReport.url,
    });
  }

  /**
   * Get recent errors
   */
  getErrors(limit = 20): ErrorReport[] {
    return this.errors
      .slice()
      .reverse()
      .slice(0, limit);
  }

  /**
   * Get error rate over time
   */
  getErrorRate(timeWindowMs = 60000): number {
    const now = Date.now();
    const recentErrors = this.errors.filter(e => now - e.timestamp < timeWindowMs);
    const recentMetrics = this.metrics.filter(m => now - m.timestamp < timeWindowMs);
    
    if (recentMetrics.length === 0) return 0;
    return (recentErrors.length / recentMetrics.length) * 100;
  }

  /**
   * Clear all errors
   */
  clearErrors() {
    this.errors = [];
  }

  /**
   * Log error summary to console
   */
  logErrors(limit = 10) {
    const errors = this.getErrors(limit);
    if (errors.length === 0) {
      console.log('No errors tracked');
      return;
    }

    console.group(`🚨 Recent Errors (${errors.length})`);
    errors.forEach((err, idx) => {
      const ago = ((Date.now() - err.timestamp) / 1000).toFixed(0);
      console.log(`${idx + 1}. [${ago}s ago] ${err.message}`);
      if (err.context) {
        console.log('   Context:', err.context);
      }
      if (err.stack) {
        console.log('   Stack:', err.stack);
      }
    });
    console.groupEnd();
  }
}

export const monitor = new PerformanceMonitor();

// Expose monitor to window for debugging
if (typeof window !== 'undefined') {
  (window as typeof window & { monitor: PerformanceMonitor }).monitor = monitor;
}

/**
 * Initialize Web Vitals tracking
 * Captures Core Web Vitals (TTFB, FCP, LCP, INP, CLS) and logs to console in development
 */
export function initWebVitals() {
  if (typeof window === 'undefined') return;

  // Crawlers and some extensions hand back an empty module (JAVASCRIPT-REACT-DN / -DH);
  // vitals are a nice-to-have, so an odd import never becomes an unhandled rejection.
  import('web-vitals').then((vitals) => {
    if (!vitals || typeof vitals.onCLS !== 'function') return
    const { onCLS, onFCP, onLCP, onTTFB, onINP } = vitals
    const logVital = (metric: { name: string; value: number; rating: string }) => {
      const isDev = import.meta.env.DEV;
      if (isDev) {
        console.log(`[Web Vitals] ${metric.name}:`, {
          value: metric.value,
          rating: metric.rating,
        });
      }
      
      // Store in performance metrics for analysis
      monitor.recordMetric({
        name: `web_vital_${metric.name.toLowerCase()}`,
        duration: metric.value,
        timestamp: Date.now(),
        success: metric.rating === 'good',
        tags: { rating: metric.rating, route: window.location.pathname },
      });
    };

    onCLS(logVital);
    onFCP(logVital);
    onLCP(logVital);
    onTTFB(logVital);
    onINP(logVital);
  }).catch(() => { /* vitals unavailable: nothing to measure */ });
}

/**
 * Usage examples:
 * 
 * // Measure an operation
 * const profile = await monitor.measure('fetch_profile', () =>
 *   supabase.from('profiles').select('*').eq('id', userId).single()
 * );
 * 
 * // Measure with tags
 * const profile = await monitor.measure(
 *   'fetch_profile',
 *   () => supabase.from('profiles').select('*').eq('id', userId).single(),
 *   { userId, source: 'dashboard' }
 * );
 * 
 * // Track errors
 * try {
 *   await riskyOperation()
 * } catch (error) {
 *   monitor.trackError(error, { operation: 'riskyOperation', userId }, userId)
 * }
 * 
 * // View stats in console
 * monitor.logStats('fetch_profile');
 * monitor.logAllStats();
 * monitor.logErrors();
 * 
 * // Check health
 * const health = monitor.getHealthStatus();
 * console.log('System health:', health);
 * 
 * // Get error rate
 * const errorRate = monitor.getErrorRate(); // Last 60s
 * console.log(`Error rate: ${errorRate.toFixed(2)}%`);
 * 
 * // Initialize Web Vitals tracking (call once in main.tsx)
 * initWebVitals();
 */

