import type { Core } from '@strapi/strapi';
import fetchTranscript from '../utils/fetch-transcript';

const PLUGIN_ID = 'ai-sdk-yt-transcripts';
const CONTENT_TYPE_UID = 'plugin::ai-sdk-yt-transcripts.transcript';

interface PluginConfig {
  proxyUrl?: string;
}

const service = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getTranscript(identifier: string) {
    const youtubeIdRegex = /^[a-zA-Z0-9_-]{11}$/;
    const isValid = youtubeIdRegex.test(identifier);
    if (!isValid) {
      return { error: 'Invalid video ID', data: null };
    }

    // Get proxy config
    const pluginConfigFromGet = strapi.config.get(`plugin::${PLUGIN_ID}`) as any;
    const pluginInstance = strapi.plugin(PLUGIN_ID);
    const configFromPlugin = pluginInstance?.config;

    strapi.log.info(`[${PLUGIN_ID}] Config from strapi.config.get: ${JSON.stringify(pluginConfigFromGet)}`);
    strapi.log.info(`[${PLUGIN_ID}] Config from plugin.config: ${typeof configFromPlugin === 'function' ? 'function' : JSON.stringify(configFromPlugin)}`);

    // Try to get proxyUrl from various places
    let proxyUrl: string | undefined;

    // Method 1: Direct from plugin config function (Strapi v5 way)
    if (typeof configFromPlugin === 'function') {
      proxyUrl = configFromPlugin('proxyUrl');
      strapi.log.info(`[${PLUGIN_ID}] proxyUrl from config function: ${proxyUrl ? 'SET' : 'NOT SET'}`);
    }

    // Method 2: From strapi.config.get (might be nested under .config)
    if (!proxyUrl && pluginConfigFromGet) {
      proxyUrl = pluginConfigFromGet.proxyUrl || pluginConfigFromGet.config?.proxyUrl;
    }

    // Log at service level using strapi logger
    if (proxyUrl) {
      const maskedUrl = proxyUrl.replace(/:([^@:]+)@/, ':****@');
      strapi.log.info(`[${PLUGIN_ID}] Fetching transcript for ${identifier} via proxy: ${maskedUrl}`);
    } else {
      strapi.log.info(`[${PLUGIN_ID}] Fetching transcript for ${identifier} (NO PROXY - check config)`);
    }

    const transcriptData = await fetchTranscript(identifier, {
      proxyUrl,
    });

    strapi.log.info(`[${PLUGIN_ID}] Successfully fetched transcript for ${identifier}`);

    return {
      title: transcriptData.title,
      fullTranscript: transcriptData.fullTranscript,
      transcriptWithTimeCodes: transcriptData.transcriptWithTimeCodes,
    };
  },

  async saveTranscript(payload: Record<string, unknown>) {
    return await strapi.documents(CONTENT_TYPE_UID as any).create({
      data: payload,
    });
  },

  async findTranscript(videoId: string) {
    strapi.log.info(`[${PLUGIN_ID}] findTranscript called with videoId: "${videoId}"`);
    const transcriptData = await strapi.documents(CONTENT_TYPE_UID as any).findFirst({
      filters: { videoId },
    });

    strapi.log.info(`[${PLUGIN_ID}] findTranscript result: ${transcriptData ? 'FOUND' : 'NOT FOUND'}`);
    if (!transcriptData) return null;
    return transcriptData;
  },
});

export default service;
