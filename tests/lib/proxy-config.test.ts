import { describe, it, expect, afterEach } from 'vitest';
import config from '../../server/src/config';
import bootstrap from '../../server/src/bootstrap';

/**
 * Up to 2.6.0 the boot warning said "Set PROXY_URL in .env", but nothing read
 * that variable: the default was a hard-coded empty string, so following the
 * advice changed nothing. The default now reads PROXY_URL, and the warning
 * names the plugin config, which is the route that always works.
 */

// Strapi calls a function-form default with its env helper. This stand-in
// has the same (key, fallback) contract.
const env = (key: string, fallback?: string) => process.env[key] ?? fallback;

function resolveDefault() {
  const d: any = config.default;
  return typeof d === 'function' ? d({ env }) : d;
}

const saved = process.env.PROXY_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.PROXY_URL;
  else process.env.PROXY_URL = saved;
});

describe('proxyUrl default', () => {
  it('reads PROXY_URL from the environment', () => {
    process.env.PROXY_URL = 'http://user:pass@proxy.example.com:8080';
    expect(resolveDefault().proxyUrl).toBe('http://user:pass@proxy.example.com:8080');
  });

  it('is empty when PROXY_URL is not set', () => {
    delete process.env.PROXY_URL;
    expect(resolveDefault().proxyUrl).toBe('');
  });

  it('passes the validator either way', () => {
    delete process.env.PROXY_URL;
    expect(() => config.validator(resolveDefault())).not.toThrow();
  });
});

describe('no-proxy warning', () => {
  it('names routes that work: PROXY_URL, now read, and the plugin config', async () => {
    const warnings: string[] = [];
    const strapi: any = {
      log: {
        info: () => {},
        warn: (m: string) => warnings.push(m),
        error: () => {},
        debug: () => {},
      },
      config: { get: () => ({ proxyUrl: '' }) },
      service: () => ({ actionProvider: { has: () => false, registerMany: async () => {} } }),
      plugin: () => ({ service: () => ({ getTools: () => [] }) }),
    };

    await bootstrap({ strapi });

    const warning = warnings.find((w) => w.includes('No proxy configured'));
    expect(warning).toBeDefined();
    expect(warning).toContain('proxyUrl');
    expect(warning).toContain('config/plugins');
    expect(warning).toContain('PROXY_URL');
  });
});
