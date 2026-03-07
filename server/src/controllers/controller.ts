import type { Core } from '@strapi/strapi';
import { extractYouTubeID } from '../utils/extract-youtube-id';

const PLUGIN_ID = 'ai-sdk-yt-transcripts';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getTranscript(ctx) {
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

    const payload = {
      videoId,
      title: transcriptData?.title || 'No title found',
      fullTranscript: transcriptData?.fullTranscript,
      transcriptWithTimeCodes: transcriptData?.transcriptWithTimeCodes,
    };

    const transcript = await strapi
      .plugin(PLUGIN_ID)
      .service('service')
      .saveTranscript(payload);

    ctx.body = { data: transcript };
  },
});

export default controller;
