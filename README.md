# Strapi Plugin: AI SDK Transcripts

Extension plugin for [strapi-plugin-ai-sdk](https://github.com/PaulBratslavsky/strapi-plugin-ai-sdk) that adds YouTube transcript tools to your AI chat and MCP server.

Fetch, search, and browse YouTube transcripts directly from Claude Desktop or the Strapi admin chat — no copy-pasting needed.

## Requirements

- Strapi v5.33+
- `strapi-plugin-ai-sdk` >= 0.7.0 (must be installed and enabled)
- Node.js 18+

## Installation

```bash
npm install strapi-plugin-ai-sdk-transcripts
```

## Configuration

Add the plugin to your `config/plugins.ts`:

```ts
export default ({ env }) => ({
  // The ai-sdk plugin must be configured first
  "ai-sdk": {
    enabled: true,
    resolve: "strapi-plugin-ai-sdk",
    config: {
      anthropicApiKey: env("ANTHROPIC_API_KEY"),
    },
  },

  "ai-sdk-transcripts": {
    enabled: true,
    resolve: "strapi-plugin-ai-sdk-transcripts",
    config: {
      proxyUrl: env("PROXY_URL"),           // Optional: HTTP/HTTPS proxy for YouTube requests
      chunkSizeSeconds: 300,                // Chunk size for transcript pagination (default: 5 min)
      previewLength: 500,                   // Preview length in characters (default: 500)
      maxFullTranscriptLength: 50000,       // Auto-return full transcript if under this limit (default: ~12K tokens)
      searchSegmentSeconds: 30,             // Segment size for BM25 search (default: 30s)
    },
  },
});
```

### Proxy setup

YouTube may block requests from server IPs. If you see `LOGIN_REQUIRED` errors, configure a residential proxy:

```env
PROXY_URL=http://user:password@proxy.example.com:8080
```

The plugin tests proxy connectivity on startup and logs the result. Credentials are masked in logs.

## Tools

This plugin registers 5 tools that appear in both the Strapi admin chat and the MCP server:

| Tool | MCP Name | Purpose |
|------|----------|---------|
| **fetchTranscript** | `ai_sdk_transcripts__fetch_transcript` | Fetch a transcript from YouTube and save it |
| **getTranscript** | `ai_sdk_transcripts__get_transcript` | Retrieve a saved transcript (full, chunked, or time range) |
| **searchTranscript** | `ai_sdk_transcripts__search_transcript` | BM25 full-text search within a transcript |
| **listTranscripts** | `ai_sdk_transcripts__list_transcripts` | List all saved transcripts with pagination |
| **findTranscripts** | `ai_sdk_transcripts__find_transcripts` | Search across transcripts by title, videoId, or content |

All tools accept YouTube video IDs (`dQw4w9WgXcQ`) or full URLs (`https://youtube.com/watch?v=dQw4w9WgXcQ`).

### fetchTranscript

Fetches a transcript from YouTube and saves it to the database. Returns metadata and a preview — not the full text — to avoid flooding the context window. If the transcript was already fetched, returns the cached version.

**Parameters:**
- `videoId` (required) — YouTube video ID or URL

### getTranscript

Retrieves a saved transcript with flexible output modes:

- **Preview** (default for large transcripts) — first 500 characters + metadata
- **Full** — set `includeFullTranscript: true` (auto-enabled for transcripts under 50K chars)
- **Time range** — set `startTime` and `endTime` in seconds
- **Chunked** — set `chunkIndex` for paginated 5-minute chunks

**Parameters:**
- `videoId` (required) — YouTube video ID or URL
- `includeFullTranscript` — return entire text
- `includeTimecodes` — include timestamped entries
- `startTime` / `endTime` — time range in seconds
- `chunkIndex` — zero-based chunk index
- `chunkSize` — override default chunk size in seconds (min 30)

### searchTranscript

Searches within a saved transcript using BM25 relevance scoring. Returns the most relevant segments with timestamps and scores.

**Parameters:**
- `videoId` (required) — YouTube video ID or URL
- `query` (required) — search query
- `maxResults` — max segments to return (1-20, default 5)

### listTranscripts

Lists all saved transcripts with pagination. Returns metadata only (no content).

**Parameters:**
- `page` — page number (default 1)
- `pageSize` — items per page (1-100, default 25)
- `sort` — sort field and direction (default `createdAt:desc`)

### findTranscripts

Searches across all saved transcripts by title, video ID, or content.

**Parameters:**
- `query` — full-text search across title, videoId, and content
- `videoId` — filter by video ID (partial match)
- `title` — filter by title (partial match)
- `includeFullContent` — return full transcript text (default: 244-char preview)
- `page`, `pageSize`, `sort` — pagination and sorting

## How It Works

This plugin uses the **ai-sdk tool registry** pattern — the standard way to extend `strapi-plugin-ai-sdk` with new tools.

### Architecture

```
┌─────────────────────────────────┐
│  Claude Desktop / Admin Chat    │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│  strapi-plugin-ai-sdk           │
│  ┌────────────────────────────┐ │
│  │  Tool Registry             │ │
│  │  ├── built-in tools        │ │
│  │  ├── ai_sdk_transcripts__* │◄├──── this plugin registers tools here
│  │  └── other_plugin__*       │ │
│  └────────────────────────────┘ │
│  ┌──────────┐ ┌──────────────┐  │
│  │ AI Chat  │ │  MCP Server  │  │
│  └──────────┘ └──────────────┘  │
└─────────────────────────────────┘
```

### Registration flow

1. Strapi boots and initializes `strapi-plugin-ai-sdk`, which creates the `ToolRegistry`
2. The ai-sdk plugin calls `discoverPluginTools()` — it loops through all installed plugins looking for an `ai-tools` service
3. This plugin exposes an `ai-tools` service with a `getTools()` method that returns 5 tool definitions
4. The ai-sdk registers each tool with a namespace prefix (`ai_sdk_transcripts__`) to prevent name collisions
5. Tools are now available in admin chat, public chat (all are marked `publicSafe`), and the MCP server

### Building your own extension plugin

Any Strapi plugin can contribute tools to the ai-sdk by following this pattern:

**1. Define your tools:**

```ts
// server/src/tools/my-tool.ts
import { z } from 'zod';

export const myTool = {
  name: 'myTool',
  description: 'What this tool does and when to use it',
  schema: z.object({
    query: z.string().describe('The search query'),
  }),
  execute: async (args, strapi) => {
    // Your logic here — return a plain object
    return { results: [] };
  },
  publicSafe: true, // set to true if safe for unauthenticated users
};
```

**2. Create the `ai-tools` service:**

```ts
// server/src/services/ai-tools.ts
import { myTool } from '../tools/my-tool';

export default ({ strapi }) => ({
  getTools() {
    return [myTool];
  },
});
```

**3. Register the service:**

```ts
// server/src/services/index.ts
import aiTools from './ai-tools';

export default {
  'ai-tools': aiTools,
};
```

That's it — the ai-sdk discovers your tools automatically at boot time. No configuration needed.

## Content Type

The plugin creates one collection type:

**Transcript** (`plugin::ai-sdk-transcripts.transcript`)

| Field | Type | Description |
|-------|------|-------------|
| title | string | YouTube video title |
| videoId | string | 11-character YouTube video ID |
| fullTranscript | richtext | Complete transcript text |
| transcriptWithTimeCodes | json | Array of `{ text, start, end, duration }` entries (milliseconds) |

Transcripts are visible in the Strapi Content Manager and can be managed manually if needed.

## License

MIT
# strapi-plugin-ai-sdk-transcripts
