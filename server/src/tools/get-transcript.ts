import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { extractYouTubeID } from '../utils/extract-youtube-id';
import type { ToolDefinition } from './index';

const PLUGIN_ID = 'ai-sdk-transcripts';

interface PluginConfig {
  chunkSizeSeconds?: number;
  previewLength?: number;
  maxFullTranscriptLength?: number;
}

interface TimecodeEntry {
  start: number;
  end: number;
  text: string;
  duration: number;
}

export const getTranscriptSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('YouTube video ID (11-character string) or full YouTube URL'),
  includeFullTranscript: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, return the entire transcript text. Warning: may be very large for long videos.'),
  includeTimecodes: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, include timestamped transcript entries alongside the text.'),
  startTime: z
    .number()
    .min(0)
    .optional()
    .describe('Start time in seconds to retrieve a specific time range of the transcript.'),
  endTime: z
    .number()
    .min(0)
    .optional()
    .describe('End time in seconds to retrieve a specific time range of the transcript.'),
  chunkIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Zero-based chunk index for paginated transcript retrieval.'),
  chunkSize: z
    .number()
    .int()
    .min(30)
    .optional()
    .describe('Chunk size in seconds for paginated retrieval (minimum 30). Overrides the default chunk size.'),
});

export const getTranscriptDescription =
  'Get a saved transcript by YouTube video ID. Returns metadata and preview by default. Use parameters to get full content or specific time ranges to avoid context overflow.';

/**
 * Get transcript text for a specific time range from timecoded entries
 */
function getTranscriptForTimeRange(
  timecodes: TimecodeEntry[],
  startTimeMs: number,
  endTimeMs: number
): { text: string; entries: TimecodeEntry[] } {
  const entries = timecodes.filter(
    (entry) => entry.start >= startTimeMs && entry.start < endTimeMs
  );
  const text = entries.map((e) => e.text).join(' ');
  return { text, entries };
}

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

async function execute(args: unknown, strapi: Core.Strapi): Promise<unknown> {
  const validatedArgs = getTranscriptSchema.parse(args);
  const {
    videoId: videoIdOrUrl,
    includeFullTranscript,
    includeTimecodes,
    startTime,
    endTime,
    chunkIndex,
    chunkSize: chunkSizeOverride,
  } = validatedArgs;

  const pluginConfig = strapi.config.get(`plugin::${PLUGIN_ID}`) as PluginConfig | undefined;
  const defaultChunkSize = pluginConfig?.chunkSizeSeconds || 300;
  const previewLength = pluginConfig?.previewLength || 500;
  const maxFullTranscriptLength = pluginConfig?.maxFullTranscriptLength || 50000;
  const chunkSizeSeconds = chunkSizeOverride || defaultChunkSize;

  const videoId = extractYouTubeID(videoIdOrUrl);
  if (!videoId) {
    throw new Error(`Invalid YouTube video ID or URL: "${videoIdOrUrl}". Please provide a valid 11-character video ID or YouTube URL.`);
  }

  const service = strapi.plugin(PLUGIN_ID).service('service');
  const transcript = await service.findTranscript(videoId);

  if (!transcript) {
    return {
      error: true,
      message: `No transcript found for video ID: ${videoId}. Use fetchTranscript to fetch it from YouTube first.`,
      videoId,
    };
  }

  const timecodes: TimecodeEntry[] = transcript.transcriptWithTimeCodes || [];
  const fullText: string = transcript.fullTranscript || '';
  const durationMs = getVideoDurationMs(timecodes);
  const totalChunks = Math.ceil(durationMs / (chunkSizeSeconds * 1000));
  const wordCount = fullText.split(/\s+/).length;

  const response: Record<string, unknown> = {
    videoId: transcript.videoId,
    title: transcript.title,
    metadata: {
      wordCount,
      characterCount: fullText.length,
      duration: formatTime(durationMs),
      durationSeconds: Math.floor(durationMs / 1000),
      totalChunks,
      chunkSizeSeconds,
    },
  };

  // Handle time range request
  if (startTime !== undefined || endTime !== undefined) {
    const startMs = (startTime || 0) * 1000;
    const endMs = endTime !== undefined ? endTime * 1000 : durationMs;

    const { text, entries } = getTranscriptForTimeRange(timecodes, startMs, endMs);

    response.timeRange = {
      startTime: startTime || 0,
      endTime: endTime || Math.floor(durationMs / 1000),
      startFormatted: formatTime(startMs),
      endFormatted: formatTime(endMs),
    };
    response.transcript = text;

    if (includeTimecodes) {
      response.transcriptWithTimeCodes = entries;
    }
  }
  // Handle chunk request
  else if (chunkIndex !== undefined) {
    const chunkStartMs = chunkIndex * chunkSizeSeconds * 1000;
    const chunkEndMs = Math.min((chunkIndex + 1) * chunkSizeSeconds * 1000, durationMs);

    if (chunkStartMs >= durationMs) {
      response.error = `Chunk index ${chunkIndex} is out of range. Total chunks: ${totalChunks} (0-${totalChunks - 1})`;
    } else {
      const { text, entries } = getTranscriptForTimeRange(timecodes, chunkStartMs, chunkEndMs);

      response.chunk = {
        index: chunkIndex,
        totalChunks,
        startTime: Math.floor(chunkStartMs / 1000),
        endTime: Math.floor(chunkEndMs / 1000),
        startFormatted: formatTime(chunkStartMs),
        endFormatted: formatTime(chunkEndMs),
      };
      response.transcript = text;

      if (includeTimecodes) {
        response.transcriptWithTimeCodes = entries;
      }

      if (chunkIndex < totalChunks - 1) {
        response.nextChunk = `Use chunkIndex: ${chunkIndex + 1} to get the next portion`;
      }
      if (chunkIndex > 0) {
        response.previousChunk = `Use chunkIndex: ${chunkIndex - 1} to get the previous portion`;
      }
    }
  }
  // Handle full transcript request OR auto-load if small enough
  else if (includeFullTranscript || fullText.length <= maxFullTranscriptLength) {
    response.transcript = fullText;

    if (includeTimecodes) {
      response.transcriptWithTimeCodes = timecodes;
    }

    if (includeFullTranscript && fullText.length > maxFullTranscriptLength) {
      response.warning = 'Full transcript included. For long videos, consider using chunkIndex, startTime/endTime, or searchTranscript to reduce response size.';
    } else if (fullText.length <= maxFullTranscriptLength) {
      response.note = 'Full transcript auto-loaded (fits within context limit).';
    }
  }
  // Default for large transcripts: return preview only
  else {
    const preview = fullText.length > previewLength
      ? fullText.substring(0, previewLength) + '...'
      : fullText;

    response.preview = preview;
    response.isLargeTranscript = true;
    response.usage = {
      fullTranscript: 'Set includeFullTranscript: true to get complete text (warning: may exceed context)',
      search: 'Use searchTranscript to find relevant portions by keyword (recommended for large transcripts)',
      timeRange: 'Use startTime and endTime (in seconds) to get a specific portion',
      pagination: `Use chunkIndex (0-${totalChunks - 1}) to paginate through ${chunkSizeSeconds}s chunks`,
    };
  }

  return response;
}

export const getTranscriptTool: ToolDefinition = {
  name: 'getTranscript',
  description: getTranscriptDescription,
  schema: getTranscriptSchema,
  execute,
  publicSafe: true,
};
