import type { Core } from '@strapi/strapi';
import { extractYouTubeID } from '../utils/extract-youtube-id';

const PLUGIN_ID = 'ai-sdk-yt-transcripts';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getTranscript(ctx) {
    try {
      const videoId = extractYouTubeID(ctx.params.videoId);

      if (!videoId) {
        return (ctx.body = { error: 'Invalid YouTube URL or ID', data: null });
      }

      // Check if transcript exists in database
      const found = await strapi
        .plugin(PLUGIN_ID)
        .service('service')
        .findTranscript(videoId);

      if (found) {
        return (ctx.body = { data: found });
      }

      // Fetch from YouTube
      const transcriptData = await strapi
        .plugin(PLUGIN_ID)
        .service('service')
        .getTranscript(videoId);

      if (!transcriptData || transcriptData.error) {
        ctx.throw(400, transcriptData?.error || 'Failed to fetch transcript');
        return;
      }

      const payload = {
        videoId,
        title: transcriptData.title || 'No title found',
        fullTranscript: transcriptData.fullTranscript,
        transcriptWithTimeCodes: transcriptData.transcriptWithTimeCodes,
      };

      // Save to transcript collection
      const transcript = await strapi
        .plugin(PLUGIN_ID)
        .service('service')
        .saveTranscript(payload);

      strapi.log.info(`[${PLUGIN_ID}] Saved transcript for ${videoId} (documentId: ${(transcript as any)?.documentId})`);

      ctx.body = { data: transcript };
    } catch (error: any) {
      if (error.status) throw error;
      strapi.log.error(`[${PLUGIN_ID}] getTranscript error: ${error.message}`);
      ctx.throw(500, error.message || 'Failed to get transcript');
    }
  },
});

export default controller;
