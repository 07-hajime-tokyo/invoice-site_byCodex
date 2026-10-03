export function createStepTimer(label: string) {
  const startedAt = Date.now();
  let lastAt = startedAt;
  const steps: Array<{ name: string; ms: number }> = [];
  return {
    async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const from = Date.now();
      try {
        return await fn();
      } finally {
        const now = Date.now();
        steps.push({ name, ms: now - from });
        lastAt = now;
      }
    },
    mark(name: string) {
      const now = Date.now();
      steps.push({ name, ms: now - lastAt });
      lastAt = now;
    },
    done(extra: Record<string, unknown> = {}) {
      console.info(`[perf] ${label}`, {
        totalMs: Date.now() - startedAt,
        steps,
        ...extra,
      });
    },
  };
}
