import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolDefinition } from './index';

const CONTENT_TYPE_UID = 'plugin::ai-sdk-transcripts.transcript';

const TRANSCRIPT_PREVIEW_LENGTH = 244;

export const findTranscriptsSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Full-text search query across title, videoId, and transcript content'),
  videoId: z
    .string()
    .optional()
    .describe('Filter by video ID (case-insensitive partial match)'),
  title: z
    .string()
    .optional()
    .describe('Filter by transcript title (case-insensitive partial match)'),
  includeFullContent: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, return full transcript content instead of truncated previews'),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe('Page number for pagination (starts at 1)'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(25)
    .describe('Number of transcripts per page (1-100)'),
  sort: z
    .string()
    .optional()
    .default('createdAt:desc')
    .describe('Sort field and direction, e.g. "createdAt:desc" or "title:asc"'),
});

export const findTranscriptsDescription =
  'Search and filter transcripts based on query criteria. Returns multiple matching transcripts with truncated previews (244 chars). Use getTranscript for full content. Supports filtering by title, videoId, and full-text search.';

/**
 * Truncates a string to a maximum length with ellipsis
 */
function truncateText(text: string | null | undefined, maxLength: number): string | null {
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Truncates transcript fields in an array of transcripts
 */
function truncateTranscripts(transcripts: any[]): any[] {
  return transcripts.map((transcript) => ({
    ...transcript,
    fullTranscript: truncateText(transcript.fullTranscript, TRANSCRIPT_PREVIEW_LENGTH),
  }));
}

async function execute(args: unknown, strapi: Core.Strapi): Promise<unknown> {
  const validatedArgs = findTranscriptsSchema.parse(args);
  const { query, videoId, title, includeFullContent, page, pageSize, sort } = validatedArgs;

  const start = (page - 1) * pageSize;

  const filters: Record<string, any> = {};

  if (videoId) {
    filters.videoId = { $containsi: videoId };
  }

  if (title) {
    filters.title = { $containsi: title };
  }

  if (query) {
    filters.$or = [
      { title: { $containsi: query } },
      { videoId: { $containsi: query } },
      { fullTranscript: { $containsi: query } },
    ];
  }

  const transcripts = await strapi.documents(CONTENT_TYPE_UID as any).findMany({
    filters,
    sort,
    limit: pageSize,
    start,
  });

  const allMatching = await strapi.documents(CONTENT_TYPE_UID as any).findMany({
    filters,
  });
  const total = allMatching.length;

  const processedTranscripts = includeFullContent ? transcripts : truncateTranscripts(transcripts);

  return {
    data: processedTranscripts,
    pagination: {
      page,
      pageSize,
      total,
      pageCount: Math.ceil(total / pageSize),
    },
    filters: {
      query: query || null,
      videoId: videoId || null,
      title: title || null,
    },
    ...(!includeFullContent && { note: 'Transcript content truncated to 244 chars. Use getTranscript for full content or set includeFullContent=true.' }),
  };
}

export const findTranscriptsTool: ToolDefinition = {
  name: 'findTranscripts',
  description: findTranscriptsDescription,
  schema: findTranscriptsSchema,
  execute,
  publicSafe: true,
};
