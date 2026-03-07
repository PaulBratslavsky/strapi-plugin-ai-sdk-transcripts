import type { Core } from '@strapi/strapi';
import type { z } from 'zod';

export interface ToolDefinition {
  /** Unique tool name in camelCase (e.g., "fetchTranscript") */
  name: string;

  /** Human-readable description for the AI model.
   *  Be specific about WHEN to use this tool and what it returns. */
  description: string;

  /** Zod schema defining accepted parameters.
   *  Every field must have .describe() for the AI model. */
  schema: z.ZodObject<any>;

  /** Handler that executes the tool logic.
   *  Must return a raw JS object (no MCP envelopes). */
  execute: (
    args: unknown,
    strapi: Core.Strapi,
    context?: { adminUserId?: number }
  ) => Promise<unknown>;

  /** If true, only available in AI SDK admin chat. Not exposed via MCP. */
  internal?: boolean;

  /** If true, safe for unauthenticated public chat (read-only). */
  publicSafe?: boolean;
}

import { fetchTranscriptTool } from './fetch-transcript';
import { listTranscriptsTool } from './list-transcripts';
import { getTranscriptTool } from './get-transcript';
import { searchTranscriptTool } from './search-transcript';
import { findTranscriptsTool } from './find-transcripts';

export const tools: ToolDefinition[] = [
  fetchTranscriptTool,
  listTranscriptsTool,
  getTranscriptTool,
  searchTranscriptTool,
  findTranscriptsTool,
];

export {
  fetchTranscriptTool,
  listTranscriptsTool,
  getTranscriptTool,
  searchTranscriptTool,
  findTranscriptsTool,
};
