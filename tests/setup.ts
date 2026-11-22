import { afterEach } from 'vitest';

// Component tests run in happy-dom; unmount whatever they rendered.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/preact');
  cleanup();
});
