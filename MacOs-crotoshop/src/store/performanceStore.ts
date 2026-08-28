import { create } from 'zustand';

interface PerformanceMetrics {
  rendersPerSecond: number;
  averageCompositeMs: number;
  p95CompositeMs: number;
  sampleCount: number;
}

export const usePerformanceMetrics = create<PerformanceMetrics>(() => ({
  rendersPerSecond: 0,
  averageCompositeMs: 0,
  p95CompositeMs: 0,
  sampleCount: 0,
}));

const durations: number[] = [];
const timestamps: number[] = [];
let lastPublish = 0;

/** Records render cost without causing more than four React updates/second. */
export function recordComposite(durationMs: number): void {
  const now = performance.now();
  durations.push(durationMs);
  timestamps.push(now);
  if (durations.length > 120) durations.shift();
  while (timestamps.length && timestamps[0] < now - 1000) timestamps.shift();
  if (now - lastPublish < 250) return;
  lastPublish = now;
  const sorted = [...durations].sort((a, b) => a - b);
  const average = durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  usePerformanceMetrics.setState({
    rendersPerSecond: timestamps.length,
    averageCompositeMs: average,
    p95CompositeMs: p95,
    sampleCount: durations.length,
  });
}
