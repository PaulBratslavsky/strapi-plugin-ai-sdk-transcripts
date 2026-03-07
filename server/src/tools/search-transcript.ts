import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { extractYouTubeID } from '../utils/extract-youtube-id';
import type { ToolDefinition } from './index';

const PLUGIN_ID = 'ai-sdk-transcripts';

interface PluginConfig {
  searchSegmentSeconds?: number;
}

interface TimecodeEntry {
  start: number;
  end: number;
  text: string;
  duration: number;
}

interface SearchSegment {
  text: string;
  startTime: number;
  endTime: number;
  startFormatted: string;
  endFormatted: string;
}

interface ScoredSegment extends SearchSegment {
  score: number;
}

export const searchTranscriptSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('YouTube video ID (11-character string) or full YouTube URL'),
  query: z
    .string()
    .min(1)
    .describe('Search query to find relevant segments within the transcript'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Maximum number of matching segments to return (1-20)'),
});

export const searchTranscriptDescription =
  'Search within a saved transcript using BM25 scoring. Returns the most relevant segments matching your query with timestamps. Use this to find specific content in long videos without loading the entire transcript.';

/**
 * Tokenize text into lowercase words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

/**
 * Calculate IDF (Inverse Document Frequency) for each term
 */
function calculateIDF(segments: SearchSegment[], vocabulary: Set<string>): Map<string, number> {
  const idf = new Map<string, number>();
  const N = segments.length;

  for (const term of vocabulary) {
    const docsWithTerm = segments.filter((seg) =>
      tokenize(seg.text).includes(term)
    ).length;
    idf.set(term, Math.log((N - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1));
  }

  return idf;
}

/**
 * Calculate BM25 score for a segment against a query
 */
function bm25Score(
  segmentTokens: string[],
  queryTokens: string[],
  idf: Map<string, number>,
  avgDocLength: number,
  k1 = 1.5,
  b = 0.75
): number {
  const docLength = segmentTokens.length;
  let score = 0;

  const tf = new Map<string, number>();
  for (const token of segmentTokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  for (const term of queryTokens) {
    const termFreq = tf.get(term) || 0;
    const termIdf = idf.get(term) || 0;

    if (termFreq > 0) {
      const numerator = termFreq * (k1 + 1);
      const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength));
      score += termIdf * (numerator / denominator);
    }
  }

  return score;
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
 * Split transcript timecodes into segments of specified duration
 */
function createSegments(
  timecodes: TimecodeEntry[],
  segmentDurationMs: number
): SearchSegment[] {
  if (!timecodes || timecodes.length === 0) return [];

  const segments: SearchSegment[] = [];
  let currentSegment: TimecodeEntry[] = [];
  let segmentStartTime = timecodes[0].start;

  for (const entry of timecodes) {
    const segmentEndTime = segmentStartTime + segmentDurationMs;

    if (entry.start < segmentEndTime) {
      currentSegment.push(entry);
    } else {
      if (currentSegment.length > 0) {
        const endTime = currentSegment[currentSegment.length - 1].end ||
          currentSegment[currentSegment.length - 1].start + (currentSegment[currentSegment.length - 1].duration || 0);
        segments.push({
          text: currentSegment.map((e) => e.text).join(' '),
          startTime: Math.floor(segmentStartTime / 1000),
          endTime: Math.floor(endTime / 1000),
          startFormatted: formatTime(segmentStartTime),
          endFormatted: formatTime(endTime),
        });
      }

      segmentStartTime = entry.start;
      currentSegment = [entry];
    }
  }

  if (currentSegment.length > 0) {
    const endTime = currentSegment[currentSegment.length - 1].end ||
      currentSegment[currentSegment.length - 1].start + (currentSegment[currentSegment.length - 1].duration || 0);
    segments.push({
      text: currentSegment.map((e) => e.text).join(' '),
      startTime: Math.floor(segmentStartTime / 1000),
      endTime: Math.floor(endTime / 1000),
      startFormatted: formatTime(segmentStartTime),
      endFormatted: formatTime(endTime),
    });
  }

  return segments;
}

async function execute(args: unknown, strapi: Core.Strapi): Promise<unknown> {
  const validatedArgs = searchTranscriptSchema.parse(args);
  const { videoId: videoIdOrUrl, query, maxResults: maxResultsInput } = validatedArgs;

  const pluginConfig = strapi.config.get(`plugin::${PLUGIN_ID}`) as PluginConfig | undefined;
  const segmentSeconds = pluginConfig?.searchSegmentSeconds || 30;

  const maxResults = Math.min(Math.max(maxResultsInput || 5, 1), 20);

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

  if (timecodes.length === 0) {
    return {
      error: true,
      message: 'Transcript has no timecode data for searching.',
      videoId,
    };
  }

  const segments = createSegments(timecodes, segmentSeconds * 1000);

  if (segments.length === 0) {
    return {
      error: true,
      message: 'Could not create searchable segments from transcript.',
      videoId,
    };
  }

  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    return {
      error: true,
      message: 'Query is empty or contains only stop words.',
      query,
    };
  }

  const vocabulary = new Set(queryTokens);
  const idf = calculateIDF(segments, vocabulary);
  const avgDocLength = segments.reduce((sum, seg) => sum + tokenize(seg.text).length, 0) / segments.length;

  const scoredSegments: ScoredSegment[] = segments.map((segment) => ({
    ...segment,
    score: bm25Score(tokenize(segment.text), queryTokens, idf, avgDocLength),
  }));

  const results = scoredSegments
    .filter((seg) => seg.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return {
    videoId: transcript.videoId,
    title: transcript.title,
    query,
    totalSegments: segments.length,
    matchingResults: results.length,
    results: results.map((r) => ({
      text: r.text,
      startTime: r.startTime,
      endTime: r.endTime,
      timeRange: `${r.startFormatted} - ${r.endFormatted}`,
      score: Math.round(r.score * 100) / 100,
    })),
    usage: results.length > 0
      ? `Use getTranscript with startTime: ${results[0].startTime} and endTime: ${results[0].endTime} to get full context for the top result.`
      : 'No matches found. Try different keywords.',
  };
}

export const searchTranscriptTool: ToolDefinition = {
  name: 'searchTranscript',
  description: searchTranscriptDescription,
  schema: searchTranscriptSchema,
  execute,
  publicSafe: true,
};
