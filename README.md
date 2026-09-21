# YouTube Transcripts for Strapi

Fetch, store, search and read YouTube transcripts inside Strapi. It works on its
own, and it grows AI tools when you have them.

Give it a video URL and it pulls the transcript, stores it as a Strapi content
type, and gives you an admin page plus a REST API to search and read it. There
is no AI requirement and nothing to configure beyond enabling the plugin.

When the host enables Strapi's built-in MCP server, this plugin puts its five
tools on it, so Claude, Cursor and other MCP clients can use them. No chat
plugin is needed for that.

If a chat plugin is installed, such as
[`strapi-plugin-ai-chat`](https://github.com/PaulBratslavsky/strapi-plugin-ai-chat)
or `strapi-plugin-tanstack-ai`, it picks the same tools up for its admin chat.
That is additive. Nothing here depends on it, and removing it leaves a working
transcript plugin behind, tools on MCP included.

## What you get

- **Transcript store.** A `transcript` content type holding the full text plus
  per-segment timecodes, so a fetched video is fetched once.
- **Admin page.** Browse and inspect what has been captured.
- **REST API.** Content-API routes for your own frontend.
- **Search.** BM25 relevance scoring over segments, returning matching passages
  with timestamps rather than the whole transcript.
- **Pagination.** Long transcripts are chunked, so a two hour video does not
  arrive as one wall of text.
- **AI tools, when available.** `fetchTranscript`, `getTranscript`,
  `searchTranscript`, `listTranscripts` and `findTranscripts`.

## Requirements

- Strapi >= 5.47.0
- Node.js 18+

`strapi-plugin-ai-chat` is an **optional** peer. Install it only if you want the
AI tooling; the plugin runs without it.

## Installation

```bash
npm install strapi-plugin-youtube-transcripts
```

## Configuration

Add the plugin to your `config/plugins.ts`:

```ts
export default ({ env }) => ({
  // The ai-sdk plugin must be configured first
  "ai-sdk": {
    enabled: true,
    resolve: "strapi-plugin-ai-chat",
    config: {
      anthropicApiKey: env("ANTHROPIC_API_KEY"),
    },
  },

  "ai-sdk-yt-transcripts": {
    enabled: true,
    resolve: "strapi-plugin-youtube-transcripts",
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

All tools are marked `publicSafe: true`, which tiers them as read-only for permission purposes. `fetchTranscript` is the exception in practice, since it reaches YouTube and writes.

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

## REST API

The plugin also exposes a REST endpoint for direct transcript access (no AI chat needed):

```
GET /api/ai-sdk-yt-transcripts/yt-transcript/:videoId
```

Fetches the transcript for the given video ID. If it's already cached in the database, returns the cached version. Otherwise, fetches from YouTube, saves it, and returns the result.

Available on both content API (public, requires Users & Permissions) and admin API routes.

## How It Works

The plugin exposes an `ai-tools` service that the ai-sdk discovers automatically at boot time. The ai-sdk registers each tool with a namespace prefix (`ai-sdk-yt-transcripts__`) so they appear as a separate plugin source in the UI.

```ts
// services/ai-tools.ts
import { tools } from '../tools';

export default () => ({
  getTools() {
    return tools;
  },
});
```

A chat plugin reads that service to offer the tools in its admin chat. MCP is
handled here: when the host enables Strapi's MCP server
(`mcp: { enabled: true }` in `config/server.ts`), this plugin registers the
tools over `/mcp` under snake_case names such as
`youtube_transcripts__get_transcript`, whether or not a chat plugin is
installed.

Each tool has its own permission, `plugin::youtube-transcripts.tool.<slug>`,
which appears under this plugin's own section of **Settings > Roles**. Granted
on a role it decides what an admin's chat can use; granted on an admin token it
decides what that token exposes over MCP. `fetchTranscript` is the one to grant
deliberately: it calls YouTube and persists a transcript, which can cascade into
a paid embedding run in the sibling embeddings plugin, so the risk is external
cost rather than a database write.

### Architecture

```
┌──────────────────────┐   ┌──────────────────────────┐
│  MCP client          │   │  Strapi admin chat        │
│  (Claude, Cursor)    │   │  (ai-chat, tanstack-ai)   │
└──────────┬───────────┘   └────────────┬─────────────┘
           │ POST /mcp                  │ reads ai-tools
┌──────────▼───────────┐                │
│  Strapi MCP server   │                │
└──────────▲───────────┘                │
           │ registerTool               │
┌──────────┴────────────────────────────▼─────────────┐
│  strapi-plugin-youtube-transcripts                   │
│  ├── registers its 5 tools on MCP (bootstrap)        │
│  ├── registers their permissions (bootstrap)         │
│  ├── ai-tools service (the same 5 tools, for chat)   │
│  ├── REST API (GET /yt-transcript/)                  │
│  ├── Transcript content type                         │
│  └── YouTube fetching service                        │
└──────────────────────────────────────────────────────┘
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

**Transcript** (`plugin::ai-sdk-yt-transcripts.transcript`)

| Field | Type | Description |
|-------|------|-------------|
| title | string | YouTube video title |
| videoId | string | 11-character YouTube video ID |
| fullTranscript | richtext | Complete transcript text |
| transcriptWithTimeCodes | json | Array of `{ text, start, end, duration }` entries (milliseconds) |

Transcripts are visible in the Strapi Content Manager and can be managed manually if needed.

## License

MIT
