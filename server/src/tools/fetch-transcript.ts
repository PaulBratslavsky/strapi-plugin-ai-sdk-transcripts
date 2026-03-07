import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { extractYouTubeID } from '../utils/extract-youtube-id';
import type { ToolDefinition } from './index';

const PLUGIN_ID = 'ai-sdk-transcripts';

interface PluginConfig {
  previewLength?: number;
}

interface TimecodeEntry {
  start: number;
  end: number;
  duration: number;
}

export const fetchTranscriptSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('YouTube video ID (11-character string) or full YouTube URL'),
});

export const fetchTranscriptDescription =
  'Fetch a transcript from YouTube for a given video ID or URL. The transcript is saved to the database. Returns metadata and preview only to avoid context overflow. Use getTranscript to retrieve content.';

/**
 * Calculate video duration from timecodes
 */
function getVideoDurationMs(timecodes: TimecodeEntry[]): number {
  if (!timecodes || timecodes.length === 0) return 0;
  const lastEntry = timecodes[timecodes.length - 1];
  return lastEntry.end || lastEntry.start + (lastEntry.duration || 0);
}

/**
 * Format milliseconds as MM:SS or HH:MM:SS
 */
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Build metadata response for a transcript
 */
function buildMetadataResponse(
  transcript: Record<string, unknown>,
  previewLength: number,
  cached: boolean
) {
  const fullText = (transcript.fullTranscript as string) || '';
  const timecodes = (transcript.transcriptWithTimeCodes as TimecodeEntry[]) || [];
  const durationMs = getVideoDurationMs(timecodes);
  const wordCount = fullText.split(/\s+/).length;

  const preview = fullText.length > previewLength
    ? fullText.substring(0, previewLength) + '...'
    : fullText;

  return {
    message: cached ? 'Transcript already exists in database' : 'Transcript fetched and saved successfully',
    cached,
    videoId: transcript.videoId,
    title: transcript.title,
    metadata: {
      wordCount,
      characterCount: fullText.length,
      duration: formatTime(durationMs),
      durationSeconds: Math.floor(durationMs / 1000),
    },
    preview,
    usage: 'Use getTranscript with videoId to retrieve full content, specific time ranges, or paginated chunks.',
  };
}

async function execute(args: unknown, strapi: Core.Strapi): Promise<unknown> {
  const validatedArgs = fetchTranscriptSchema.parse(args);
  const { videoId: videoIdOrUrl } = validatedArgs;

  const pluginConfig = strapi.config.get(`plugin::${PLUGIN_ID}`) as PluginConfig | undefined;
  const previewLength = pluginConfig?.previewLength || 500;

  const videoId = extractYouTubeID(videoIdOrUrl);
  if (!videoId) {
    throw new Error(`Invalid YouTube video ID or URL: "${videoIdOrUrl}". Please provide a valid 11-character video ID or YouTube URL.`);
  }

  const service = strapi.plugin(PLUGIN_ID).service('service');

  // Check if transcript already exists in database
  const existingTranscript = await service.findTranscript(videoId);
  if (existingTranscript) {
    return buildMetadataResponse(existingTranscript, previewLength, true);
  }

  // Fetch transcript from YouTube
  const transcriptData = await service.getTranscript(videoId);

  if (!transcriptData || !transcriptData.fullTranscript) {
    throw new Error('No transcript data returned from YouTube');
  }

  const payload: Record<string, unknown> = {
    videoId,
    title: transcriptData.title || `YouTube Video ${videoId}`,
    fullTranscript: transcriptData.fullTranscript,
    transcriptWithTimeCodes: transcriptData.transcriptWithTimeCodes,
  };

  const savedTranscript = await service.saveTranscript(payload);

  return buildMetadataResponse(savedTranscript as Record<string, unknown>, previewLength, false);
}

export const fetchTranscriptTool: ToolDefinition = {
  name: 'fetchTranscript',
  description: fetchTranscriptDescription,
  schema: fetchTranscriptSchema,
  execute,
  publicSafe: true,
};
