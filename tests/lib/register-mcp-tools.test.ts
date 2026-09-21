import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { registerMcpTools, mcpToolName } from '../../server/src/lib/register-mcp-tools';
import { actionForTool } from '../../server/src/lib/tool-permissions';
import bootstrap from '../../server/src/bootstrap';

/**
 * This plugin puts its own tools on Strapi's MCP server.
 *
 * Until 2.6.0 ai-chat did it, which meant the tools vanished from MCP whenever
 * ai-chat was not installed, even though the chat hosts (ai-chat, tanstack-ai)
 * only need the `ai-tools` service. The names below are the ones MCP clients
 * already use, as ai-chat produced them. Changing any of them breaks every
 * client that calls the tool by name.
 */
const CLIENT_VISIBLE_NAMES = [
  'youtube_transcripts__fetch_transcript',
  'youtube_transcripts__find_transcripts',
  'youtube_transcripts__get_transcript',
  'youtube_transcripts__list_transcripts',
  'youtube_transcripts__search_transcript',
];

interface Log {
  level: string;
  message: string;
}

function fakeStrapi(opts: { mcp?: 'enabled' | 'disabled' | 'absent'; taken?: string[] } = {}) {
  const { mcp = 'enabled', taken = [] } = opts;
  const registered: any[] = [];
  const logs: Log[] = [];
  const log = (level: string) => (message: string) => logs.push({ level, message });

  const strapi: any = {
    log: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') },
    config: { get: () => ({}) },
    service: () => ({ actionProvider: { has: () => false, registerMany: async () => {} } }),
  };

  if (mcp !== 'absent') {
    strapi.ai = {
      mcp: {
        isEnabled: () => mcp === 'enabled',
        registerTool: (def: any) => {
          // Mirrors @strapi/core's McpCapabilityRegistry, which throws on a
          // name that is already defined.
          if (taken.includes(def.name) || registered.some((r) => r.name === def.name)) {
            throw new Error(`[MCP] Tool with name "${def.name}" is already registered. Names must be unique.`);
          }
          registered.push(def);
        },
      },
    };
  }

  return { strapi, registered, logs };
}

describe('mcpToolName', () => {
  it('produces the names MCP clients already call', () => {
    expect(
      ['fetchTranscript', 'findTranscripts', 'getTranscript', 'listTranscripts', 'searchTranscript'].map(mcpToolName),
    ).toEqual(CLIENT_VISIBLE_NAMES);
  });
});

describe('registerMcpTools', () => {
  it('registers every public tool under its client-visible name', () => {
    const { strapi, registered } = fakeStrapi();
    const count = registerMcpTools(strapi);

    expect(count).toBe(5);
    expect(registered.map((t) => t.name).sort()).toEqual(CLIENT_VISIBLE_NAMES);
  });

  it('gates each tool on the permission this plugin registers', () => {
    const { strapi, registered } = fakeStrapi();
    registerMcpTools(strapi);

    const fetch = registered.find((t) => t.name === 'youtube_transcripts__fetch_transcript');
    expect(fetch.auth).toEqual({ policies: [{ action: actionForTool('fetchTranscript') }] });
    expect(fetch.auth.policies[0].action).toBe('plugin::youtube-transcripts.tool.fetch-transcript');
  });

  it('hands the zod schema over untouched, so descriptions reach the client', () => {
    const { strapi, registered } = fakeStrapi();
    registerMcpTools(strapi);

    const list = registered.find((t) => t.name === 'youtube_transcripts__list_transcripts');
    const schema = list.resolveInputSchema();
    expect(schema.shape.pageSize.description).toMatch(/per page/);
  });

  it('does nothing when the MCP server is disabled', () => {
    const { strapi, registered } = fakeStrapi({ mcp: 'disabled' });
    expect(registerMcpTools(strapi)).toBe(0);
    expect(registered).toHaveLength(0);
  });

  it('does nothing on a Strapi without strapi.ai, rather than throwing', () => {
    const { strapi } = fakeStrapi({ mcp: 'absent' });
    expect(() => registerMcpTools(strapi)).not.toThrow();
    expect(registerMcpTools(strapi)).toBe(0);
  });

  it('stands down on a name another plugin already registered, and keeps going', () => {
    // An older ai-chat (3.4.0 and earlier) registers these same names. Its
    // bootstrap usually runs first, so it wins and this side must not fight it.
    const { strapi, registered, logs } = fakeStrapi({ taken: ['youtube_transcripts__get_transcript'] });
    const count = registerMcpTools(strapi);

    expect(count).toBe(4);
    expect(registered.map((t) => t.name)).not.toContain('youtube_transcripts__get_transcript');
    const note = logs.find((l) => l.message.includes('youtube_transcripts__get_transcript'));
    expect(note).toBeDefined();
    expect(note?.level).not.toBe('error');
  });

  it('returns content and an object structuredContent on success', async () => {
    const { strapi, registered } = fakeStrapi();
    registerMcpTools(strapi, [
      {
        name: 'listThings',
        description: 'list',
        schema: z.object({}),
        execute: async () => [1, 2, 3],
      },
    ]);

    const result = await registered[0].createHandler(strapi, {})({ args: {} });
    expect(result.structuredContent).toEqual({ result: [1, 2, 3] });
    expect(result.content[0].text).toBe(JSON.stringify([1, 2, 3]));
    expect(result.isError).toBeUndefined();
  });

  it('reports a failing tool as isError without structuredContent', async () => {
    const { strapi, registered } = fakeStrapi();
    registerMcpTools(strapi, [
      {
        name: 'boom',
        description: 'boom',
        schema: z.object({}),
        execute: async () => {
          throw new Error('YouTube said no');
        },
      },
    ]);

    const result = await registered[0].createHandler(strapi, {})({ args: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toContain('YouTube said no');
  });

  it('refuses a result too large for an MCP client, with a message the model can act on', async () => {
    const { strapi, registered } = fakeStrapi();
    registerMcpTools(strapi, [
      {
        name: 'getHuge',
        description: 'huge',
        schema: z.object({}),
        execute: async () => ({ text: 'x'.repeat(600_000) }),
      },
    ]);

    const result = await registered[0].createHandler(strapi, {})({ args: {} });
    expect(result.structuredContent.error).toBe('RESULT_TOO_LARGE');
    expect(result.structuredContent.message).toMatch(/1 MB/);
  });

  it('skips internal tools', () => {
    const { strapi, registered } = fakeStrapi();
    registerMcpTools(strapi, [
      { name: 'secret', description: 's', schema: z.object({}), execute: async () => ({}), internal: true },
      { name: 'open', description: 'o', schema: z.object({}), execute: async () => ({}) },
    ]);
    expect(registered.map((t) => t.name)).toEqual(['youtube_transcripts__open']);
  });
});

describe('bootstrap wiring', () => {
  // The helper passing proves nothing if bootstrap never calls it: ai-chat
  // 3.1.0 shipped a fix whose helper existed and whose caller ignored it.
  it('registers the tools on MCP during bootstrap', async () => {
    const { strapi, registered } = fakeStrapi();
    await bootstrap({ strapi });
    expect(registered.map((t) => t.name).sort()).toEqual(CLIENT_VISIBLE_NAMES);
  });
});
