import type { LogLink, RunStatus } from '@tributary/contracts';
import type { ObservedStatus, PipelineRunner, RunSpec } from './runner.ts';

/** In-process runner for tests: statuses and log lines are set by the test. */
export class FakeRunner implements PipelineRunner {
  readonly kind = 'fake' as const;
  readonly started: RunSpec[] = [];
  readonly cancelled: string[] = [];
  readonly #status = new Map<string, RunStatus>();
  readonly #logs = new Map<string, string[]>();

  async start(spec: RunSpec) {
    const externalId = `fake-${spec.runId}`;
    this.started.push(spec);
    this.#status.set(externalId, 'submitted');
    return { externalId, workDir: spec.workUri };
  }

  set(externalId: string, status: RunStatus): void {
    this.#status.set(externalId, status);
  }

  log(externalId: string, lines: string[]): void {
    this.#logs.set(externalId, lines);
  }

  async getStatus(externalId: string): Promise<ObservedStatus> {
    const status = this.#status.get(externalId) ?? 'failed';
    return { status, externalStatus: status.toUpperCase() };
  }

  async cancel(externalId: string): Promise<void> {
    this.cancelled.push(externalId);
    this.#status.set(externalId, 'cancelled');
  }

  async logLinks(externalId: string): Promise<LogLink[]> {
    return [{ label: 'Fake runner log', url: `https://logs.example.test/${encodeURIComponent(externalId)}` }];
  }

  async recentLogs(externalId: string, lines: number): Promise<string[]> {
    return (this.#logs.get(externalId) ?? []).slice(-lines);
  }
}
