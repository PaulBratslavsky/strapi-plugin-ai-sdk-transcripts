// This plugin's tools, on Strapi's official MCP server.
//
// Up to 2.5.0 the chat host (strapi-plugin-ai-chat) registered them, so they
// disappeared from MCP whenever that host was not installed, even though a chat
// host only needs the `ai-tools` service to use them. Now each side does one
// job: this plugin puts its tools on MCP, and a chat host picks them up from
// `ai-tools` for its own panel.
import type { Core } from '@strapi/strapi';
import { z } from 'zod';
import { tools as defaultTools, type ToolDefinition } from '../tools';
import { actionForTool, PLUGIN_ID } from './tool-permissions';

/**
 * Namespace every MCP name carries, so `search_transcript` cannot collide with
 * another plugin's tool. Underscored because MCP tool names are snake_case.
 */
const MCP_SOURCE = PLUGIN_ID.replace(/-/g, '_');

/**
 * The MCP name for a tool, e.g. `fetchTranscript` ->
 * `youtube_transcripts__fetch_transcript`.
 *
 * These are the names ai-chat published for this plugin's tools, and MCP
 * clients call tools by name, so they must not drift.
 */
export function mcpToolName(name: string): string {
  return `${MCP_SOURCE}__${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
}

/** "youtube_transcripts__fetch_transcript" -> "YouTube Transcripts: Fetch Transcript". */
function toTitle(name: string): string {
  const words = name.replace(/[A-Z]/g, (c) => ` ${c}`);
  return `YouTube Transcripts: ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * `resolveOutputSchema` must be a ZodObject, and these tools return different
 * shapes. One permissive schema satisfies the contract for all of them.
 */
const LOOSE_OUTPUT = z.object({}).catchall(z.any());

/**
 * MCP clients reject a result over about 1 MB with an error the model cannot
 * act on. The result is sent twice (as text and as structuredContent), so the
 * doubled size is what has to fit.
 */
const MAX_WIRE_BYTES = 950_000;

function guardSize(result: unknown, toolName: string): unknown {
  const serialized = JSON.stringify(result);
  if (serialized === undefined) return result;

  const wireBytes = Buffer.byteLength(serialized, 'utf8') * 2 + 2048;
  if (wireBytes <= MAX_WIRE_BYTES) return result;

  return {
    error: 'RESULT_TOO_LARGE',
    tool: toolName,
    bytes: wireBytes,
    limitBytes: MAX_WIRE_BYTES,
    message:
      `This ${toolName} result is ~${(wireBytes / 1_000_000).toFixed(2)} MB on the wire, over the ~1 MB ` +
      'MCP response limit. Ask for less: a time range instead of the full transcript, or a smaller page.',
  };
}

/**
 * Register this plugin's public tools on the MCP server. Returns how many were
 * registered.
 *
 * Never throws: an MCP problem must not stop Strapi booting. Each tool is
 * registered on its own, because the server throws on a duplicate name and one
 * rejected tool must not cost the others.
 *
 * A duplicate is expected, not a fault. ai-chat 3.4.0 and earlier register
 * these same names, and plugin bootstrap order is not ours to control, so
 * whichever side runs first owns the tool and the other stands down.
 */
export function registerMcpTools(strapi: Core.Strapi, list: ToolDefinition[] = defaultTools): number {
  const mcp = (strapi as Core.Strapi & { ai?: { mcp?: any } }).ai?.mcp;

  // strapi.ai is missing before Strapi 5.47; isEnabled() is false unless the
  // host sets `mcp: { enabled: true }` in config/server.ts.
  let enabled = false;
  try {
    enabled = Boolean(mcp?.isEnabled?.());
  } catch {
    enabled = false;
  }
  if (!enabled) {
    strapi.log.debug(`[${PLUGIN_ID}] MCP server not enabled, tools not registered on MCP`);
    return 0;
  }

  let count = 0;
  for (const tool of list) {
    if (tool.internal) continue;

    const name = mcpToolName(tool.name);
    try {
      mcp.registerTool({
        name,
        title: toTitle(tool.name),
        description: tool.description,
        // Zod schemas are passed untouched; converting them would strip the
        // .describe() text the model relies on.
        resolveInputSchema: () => tool.schema as any,
        resolveOutputSchema: () => LOOSE_OUTPUT as any,
        auth: { policies: [{ action: actionForTool(tool.name) }] },
        createHandler: (s: Core.Strapi) => async ({ args }: { args?: unknown }) => {
          try {
            const result = guardSize(await tool.execute(args ?? {}, s), tool.name);
            // structuredContent must be an object, because the output schema is.
            const structuredContent =
              result && typeof result === 'object' && !Array.isArray(result)
                ? (result as Record<string, unknown>)
                : { result };
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            s.log.error(`[${PLUGIN_ID}] MCP tool ${name} failed: ${message}`);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message }) }],
              isError: true as const,
            };
          }
        },
      });
      count++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already registered/i.test(message)) {
        strapi.log.info(
          `[${PLUGIN_ID}] MCP tool ${name} is already registered by another plugin ` +
            '(an ai-chat older than 3.5.0 does this), leaving it there',
        );
      } else {
        strapi.log.warn(`[${PLUGIN_ID}] could not register MCP tool ${name}: ${message}`);
      }
    }
  }

  return count;
}
