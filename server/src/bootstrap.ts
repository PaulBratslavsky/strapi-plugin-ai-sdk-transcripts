import type { Core } from '@strapi/strapi';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const PLUGIN_ID = 'ai-sdk-yt-transcripts';

interface PluginConfig {
  proxyUrl?: string;
}

/**
 * Test proxy connectivity by making a request to check IP
 */
async function testProxyConnection(proxyUrl: string): Promise<{ success: boolean; ip?: string; error?: string }> {
  try {
    const proxyAgent = new ProxyAgent(proxyUrl);

    const response = await undiciFetch('https://httpbin.org/ip', {
      dispatcher: proxyAgent,
      signal: AbortSignal.timeout(10000),
    } as any);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as { origin?: string };
    return { success: true, ip: data.origin };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  // Tools are registered via the ai-tools service (see services/ai-tools.ts).
  // The ai-sdk plugin discovers and registers them automatically with namespace prefixing.

  // Log proxy configuration status and test connectivity
  const pluginConfig = strapi.config.get(`plugin::${PLUGIN_ID}`) as PluginConfig | undefined;
  if (pluginConfig?.proxyUrl) {
    const maskedUrl = pluginConfig.proxyUrl.replace(/:([^@:]+)@/, ':****@');
    strapi.log.info(`[${PLUGIN_ID}] Proxy configured: ${maskedUrl}`);

    // Test proxy connectivity (non-blocking)
    testProxyConnection(pluginConfig.proxyUrl).then((result) => {
      if (result.success) {
        strapi.log.info(`[${PLUGIN_ID}] Proxy connection successful - Outbound IP: ${result.ip}`);
      } else {
        strapi.log.error(`[${PLUGIN_ID}] Proxy connection FAILED: ${result.error}`);
        strapi.log.error(`[${PLUGIN_ID}] YouTube requests will likely fail. Check your proxy credentials and URL.`);
      }
    });
  } else {
    strapi.log.warn(`[${PLUGIN_ID}] No proxy configured - YouTube may block requests. Set PROXY_URL in .env`);
  }
};

export default bootstrap;
