import type { RunStatus } from '@tributary/contracts';
import type { StatusTone } from '@tributary/ui';

export const RUN_LABEL: Record<RunStatus, string> = {
  submitted: 'Submitted',
  pending: 'Pending',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const RUN_TONE: Record<RunStatus, StatusTone> = {
  submitted: 'pending',
  pending: 'pending',
  starting: 'pending',
  running: 'pending',
  stopping: 'warning',
  succeeded: 'ok',
  failed: 'error',
  cancelled: 'warning',
};

export const isActive = (status: RunStatus) => !['succeeded', 'failed', 'cancelled'].includes(status);
