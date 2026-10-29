import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { StatusBadge } from './index.ts';

it('OPS-01: StatusBadge renders its label with a status role and tone', () => {
  const html = renderToStaticMarkup(<StatusBadge label="API: ok" tone="ok" />);
  expect(html).toContain('role="status"');
  expect(html).toContain('data-tone="ok"');
  expect(html).toContain('API: ok');
});

it('REG-07: a non-live StatusBadge has no status role (so table rows include its text in their name)', () => {
  const html = renderToStaticMarkup(<StatusBadge label="Published" tone="ok" live={false} />);
  expect(html).not.toContain('role=');
  expect(html).toContain('Published');
});
