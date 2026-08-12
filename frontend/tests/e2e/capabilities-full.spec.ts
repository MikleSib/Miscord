import { expect, test } from '@playwright/test';

const optionalCapabilities = [
  'threads',
  'forums',
  'polls',
  'inbox',
  'server_templates',
  'server_imports',
  'webhooks',
  'webhook_files',
  'bot_platform',
] as const;

test('full profile exposes every optional product surface', async ({ request }) => {
  const response = await request.get('/api/v1/capabilities');
  expect(response.ok()).toBeTruthy();
  const capabilities = await response.json();
  for (const capability of optionalCapabilities) {
    expect(capabilities[capability], `${capability} must be enabled`).toBe(true);
  }
});
