import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import type { ToolDefinition } from './index';

const CONTENT_TYPE_UID = 'plugin::ai-sdk-transcripts.transcript';

export const listTranscriptsSchema = z.object({
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

export const listTranscriptsDescription =
  'List all saved YouTube transcripts from the database. Supports pagination and sorting.';

async function execute(args: unknown, strapi: Core.Strapi): Promise<unknown> {
  const validatedArgs = listTranscriptsSchema.parse(args);
  const { page, pageSize, sort } = validatedArgs;

  const start = (page - 1) * pageSize;

  const transcripts = await strapi.documents(CONTENT_TYPE_UID as any).findMany({
    sort,
    limit: pageSize,
    start,
    fields: ['id', 'documentId', 'title', 'videoId', 'createdAt', 'updatedAt'],
  });

  const allTranscripts = await strapi.documents(CONTENT_TYPE_UID as any).findMany({});
  const total = allTranscripts.length;

  return {
    data: transcripts,
    pagination: {
      page,
      pageSize,
      total,
      pageCount: Math.ceil(total / pageSize),
    },
  };
}

export const listTranscriptsTool: ToolDefinition = {
  name: 'listTranscripts',
  description: listTranscriptsDescription,
  schema: listTranscriptsSchema,
  execute,
  publicSafe: true,
};
