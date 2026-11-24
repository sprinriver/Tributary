// DEMO-01 placeholder: implemented after the failing tests are committed.
export type Call = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface DemoDeps {
  call: Call;
  readFixture(path: string): Uint8Array;
  putPart(url: string, bytes: Uint8Array): Promise<string | null>;
  settleIngest?(): Promise<void>;
  log?(line: string): void;
}

export interface DemoDataset {
  experiment: string;
  dataset: string;
}

export const DEMO_DATASETS: DemoDataset[] = [];

export async function loadDemoData(
  _deps: DemoDeps,
): Promise<{ dataset: string; status: 'created' | 'exists' }[]> {
  throw new Error('not implemented');
}
