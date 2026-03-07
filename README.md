# Strapi Plugin: AI SDK Transcripts

Extension plugin for [strapi-plugin-ai-sdk](https://github.com/PaulBratslavsky/strapi-plugin-ai-sdk) that adds YouTube transcript tools to the Strapi admin AI chat.

Fetch, search, and browse YouTube transcripts directly from the Strapi admin chat. Tools are registered with the ai-sdk's tool registry at boot time, so they're available in admin chat, public chat, and on the ai-sdk's MCP server automatically.

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

This plugin registers 5 tools with the ai-sdk tool registry:

| Tool | Purpose |
|------|---------|
| **fetchTranscript** | Fetch a transcript from YouTube and save it |
| **getTranscript** | Retrieve a saved transcript (full, chunked, or time range) |
| **searchTranscript** | BM25 full-text search within a transcript |
| **listTranscripts** | List all saved transcripts with pagination |
| **findTranscripts** | Search across transcripts by title, videoId, or content |

All tools accept YouTube video IDs (`dQw4w9WgXcQ`) or full URLs (`https://youtube.com/watch?v=dQw4w9WgXcQ`).

All tools are marked `publicSafe: true`, so they're also available in the public chat widget.

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

On startup, the plugin's `bootstrap` function accesses the ai-sdk plugin's tool registry and registers all 5 tools directly:

```ts
// bootstrap.ts (simplified)
const aiSdk = strapi.plugin('ai-sdk');
for (const tool of tools) {
  aiSdk.toolRegistry.register(tool);
}
```

Once registered, the ai-sdk handles the rest — tools are available in admin chat, public chat (since all are `publicSafe`), and exposed on the MCP server as snake_case names (`fetch_transcript`, `get_transcript`, etc.).

### Architecture

```
┌──────────────────────────────────┐
│  Strapi Admin Chat / MCP Client  │
└──────────────┬───────────────────┘
               │
┌──────────────▼───────────────────┐
│  strapi-plugin-ai-sdk            │
│  ┌─────────────────────────────┐ │
│  │  Tool Registry              │ │
│  │  ├── built-in tools         │ │
│  │  ├── fetchTranscript        │◄├──── registered by this plugin
│  │  ├── getTranscript          │◄├──── at boot time
│  │  ├── searchTranscript       │◄├
│  │  ├── listTranscripts        │◄├
│  │  └── findTranscripts        │◄├
│  └─────────────────────────────┘ │
│  ┌──────────┐  ┌──────────────┐  │
│  │ AI Chat  │  │  MCP Server  │  │
│  └──────────┘  └──────────────┘  │
└──────────────────────────────────┘
```

### YouTube transcript fetching

The plugin uses [youtubei.js](https://github.com/LuanRT/YouTube.js) to fetch transcripts from YouTube. It:

1. Creates an Innertube client (with optional proxy via `undici`)
2. Fetches the video info and caption tracks
3. Parses the XML caption data into timestamped segments
4. Saves the full transcript and timecodes to the database

Transcripts are fetched once and cached in the database. Subsequent requests for the same video return the saved version.

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
