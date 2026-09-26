import type { Core } from '@strapi/strapi';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { backfillMetadata } from './lib/backfill-metadata';
import { registerMcpTools } from './lib/register-mcp-tools';
import { registerToolPermissions } from './lib/tool-permissions';

const PLUGIN_ID = 'youtube-transcripts';

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
  // This plugin owns its tools end to end: their admin permissions and their
  // place on Strapi's MCP server. Chat hosts (ai-chat, tanstack-ai) only read
  // them from the ai-tools service (see services/ai-tools.ts) for their panels.
  //
  // Both must happen in bootstrap. The action provider refuses registrations
  // once Strapi is loaded, and the MCP server refuses tools once it has
  // started. Permissions go first so each tool's gating action exists.
  await registerToolPermissions(strapi);
  const onMcp = registerMcpTools(strapi);
  if (onMcp > 0) {
    strapi.log.info(`[${PLUGIN_ID}] registered ${onMcp} MCP tool(s)`);
  }

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
    strapi.log.warn(
      `[${PLUGIN_ID}] No proxy configured - YouTube may block requests. Set PROXY_URL in .env, ` +
        `or set proxyUrl in the plugin config (config/plugins.ts), for example proxyUrl: env('PROXY_URL')`
    );
  }

  // Opt-in only. Runs after boot rather than during it, because it makes one
  // network call per stored video and a slow YouTube must not delay the app.
  const cfg = strapi.config.get(`plugin::${PLUGIN_ID}`) as { backfillMetadata?: boolean; proxyUrl?: string } | undefined;
  if (cfg?.backfillMetadata) {
    strapi.log.info(`[${PLUGIN_ID}] backfillMetadata is enabled, refetching metadata for stored transcripts`);
    void backfillMetadata(strapi, { proxyUrl: cfg.proxyUrl }).catch((error) => {
      strapi.log.warn(`[${PLUGIN_ID}] backfill did not complete: ${(error as Error).message}`);
    });
  }
};

export default bootstrap;
