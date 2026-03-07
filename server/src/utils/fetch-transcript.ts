import { Innertube } from 'youtubei.js';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  duration: number;
}

export interface TranscriptData {
  videoId: string;
  title?: string;
  fullTranscript: string;
  transcriptWithTimeCodes: TranscriptSegment[];
}

export interface FetchOptions {
  proxyUrl?: string;
}

/**
 * Check if an object is Request-like (has url, method, headers properties)
 * We can't rely on instanceof Request since the Request class may differ across environments
 */
function isRequestLike(input: unknown): input is Request {
  return (
    typeof input === 'object' &&
    input !== null &&
    'url' in input &&
    typeof (input as Request).url === 'string' &&
    'method' in input
  );
}

/**
 * Create a proxy-enabled fetch function using undici
 */
function createProxyFetch(proxyUrl?: string): typeof fetch | undefined {
  if (!proxyUrl) {
    return undefined;
  }

  const proxyAgent = new ProxyAgent(proxyUrl);
  const maskedProxyUrl = proxyUrl.replace(/:([^@:]+)@/, ':****@');

  return (async (input: string | URL | Request, init?: RequestInit) => {
    let url: string;
    let method: string;
    let headers: Record<string, string> = {};
    let body: any;

    // Check for Request-like objects (can't rely on instanceof across environments)
    if (isRequestLike(input)) {
      const request = input;
      url = request.url;
      method = init?.method || request.method || 'GET';

      // Convert Request headers to plain object
      if (request.headers && typeof request.headers.forEach === 'function') {
        request.headers.forEach((value: string, key: string) => {
          headers[key] = value;
        });
      }

      // Merge with init headers (init takes precedence)
      if (init?.headers) {
        const initHeaders =
          init.headers instanceof Headers
            ? Object.fromEntries((init.headers as Headers).entries())
            : (init.headers as Record<string, string>);
        headers = { ...headers, ...initHeaders };
      }

      // Prefer body from init, otherwise use request body
      if (init?.body !== undefined) {
        body = init.body;
      } else if (method !== 'GET' && method !== 'HEAD' && request.body) {
        // Clone and read the request body if needed
        try {
          const cloned = request.clone();
          body = await cloned.text();
        } catch {
          // Body might not be available
        }
      }
    } else {
      // Handle string or URL with init options
      url = input instanceof URL ? input.toString() : input;
      method = init?.method || 'GET';
      if (init?.headers) {
        headers =
          init.headers instanceof Headers
            ? Object.fromEntries((init.headers as Headers).entries())
            : (init.headers as Record<string, string>);
      }
      body = init?.body;
    }

    const options: any = {
      method,
      headers,
      dispatcher: proxyAgent,
    };

    if (body && method !== 'GET' && method !== 'HEAD') {
      options.body = body;
    }

    // Log request details
    const urlPath = new URL(url).pathname;
    console.log(`[ai-sdk-transcripts] Proxy ${method} ${urlPath} via ${maskedProxyUrl}`);

    const response = await undiciFetch(url, options);

    // Log response status
    if (!response.ok) {
      console.log(`[ai-sdk-transcripts] Proxy response: ${response.status} ${response.statusText}`);
    }

    return response;
  }) as typeof fetch;
}

/**
 * Decode HTML entities in transcript text
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * Parse <p t="ms" d="ms">text</p> format (Android client)
 */
function parsePTagFormat(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const pTagRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;

  let match = pTagRegex.exec(xml);
  while (match !== null) {
    const [, startMsStr, durationMsStr, rawText] = match;
    if (startMsStr && durationMsStr && rawText) {
      const text = decodeHtmlEntities(rawText);
      if (text) {
        const start = parseInt(startMsStr, 10);
        const duration = parseInt(durationMsStr, 10);
        segments.push({
          text,
          start,
          end: start + duration,
          duration,
        });
      }
    }
    match = pTagRegex.exec(xml);
  }
  return segments;
}

/**
 * Parse <text start="sec" dur="sec">text</text> format (alternative format)
 */
function parseTextTagFormat(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const textTagRegex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;

  let match = textTagRegex.exec(xml);
  while (match !== null) {
    const [, startStr, durStr, rawText] = match;
    if (startStr && rawText) {
      const text = decodeHtmlEntities(rawText);
      if (text) {
        const start = Math.round(parseFloat(startStr) * 1000);
        const duration = Math.round(parseFloat(durStr || '0') * 1000);
        segments.push({
          text,
          start,
          end: start + duration,
          duration,
        });
      }
    }
    match = textTagRegex.exec(xml);
  }
  return segments;
}

/**
 * Parse timedtext XML into transcript segments
 * Supports both <p> format (Android) and <text> format (alternative)
 */
function parseTimedTextXml(xml: string): TranscriptSegment[] {
  // Try <p> tag format first (Android client format)
  const pSegments = parsePTagFormat(xml);
  if (pSegments.length > 0) {
    return pSegments;
  }
  // Fall back to <text> tag format
  return parseTextTagFormat(xml);
}

/**
 * Fetch timedtext XML from caption URL
 */
async function fetchTimedTextXml(
  captionUrl: string,
  proxyFetch?: typeof fetch
): Promise<string> {
  const fetchFn = proxyFetch || fetch;
  const response = await fetchFn(captionUrl, {
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch timedtext: ${response.status}`);
  }

  const xml = await response.text();
  if (!xml || xml.length === 0) {
    throw new Error('Empty timedtext response');
  }

  return xml;
}

/**
 * Fetch transcript using youtubei.js getBasicInfo to get caption URLs
 * This approach uses the Innertube client to get caption track URLs,
 * then fetches timedtext directly - avoiding BotGuard requirements.
 */
async function fetchTranscriptFromYouTube(
  videoId: string,
  options?: FetchOptions
): Promise<TranscriptData> {
  const proxyFetch = createProxyFetch(options?.proxyUrl);

  // Log proxy status for debugging
  if (options?.proxyUrl) {
    const maskedUrl = options.proxyUrl.replace(/:([^@:]+)@/, ':****@');
    console.log(`[ai-sdk-transcripts] Fetching video ${videoId} via proxy: ${maskedUrl}`);
  } else {
    console.log(`[ai-sdk-transcripts] Fetching video ${videoId} without proxy`);
  }

  // 1. Create Innertube client with optional proxy
  const client = await Innertube.create({
    generate_session_locally: true,
    lang: 'en',
    location: 'US',
    retrieve_player: true, // Required to get caption tracks
    fetch: proxyFetch,
  });

  // 2. Get basic info (includes caption tracks)
  const info = await client.getBasicInfo(videoId);

  // Get title from basic info
  const title = info.basic_info?.title;

  // 3. Check for caption tracks
  const captionTracks = info.captions?.caption_tracks;
  const playabilityStatus = (info as any).playability_status;

  // Log detailed info for debugging
  console.log(`[ai-sdk-transcripts] Video ${videoId} - Title: ${info.basic_info?.title || 'Unknown'}`);
  console.log(`[ai-sdk-transcripts] Video ${videoId} - Playability: ${playabilityStatus?.status || 'Unknown'}`);
  console.log(`[ai-sdk-transcripts] Video ${videoId} - Caption tracks found: ${captionTracks?.length || 0}`);

  if (!captionTracks || captionTracks.length === 0) {
    // Check playability status for more details
    const status = playabilityStatus?.status;
    const reason = playabilityStatus?.reason;
    const subreason = playabilityStatus?.messages?.[0] || playabilityStatus?.subreason;

    console.log(`[ai-sdk-transcripts] Video ${videoId} - No captions found`);
    console.log(`[ai-sdk-transcripts] Video ${videoId} - Playability status: ${status || 'Unknown'}`);
    if (reason) {
      console.log(`[ai-sdk-transcripts] Video ${videoId} - Playability reason: ${reason}`);
    }
    if (subreason) {
      console.log(`[ai-sdk-transcripts] Video ${videoId} - Playability subreason: ${subreason}`);
    }

    // Check for various error conditions
    if (reason && reason.includes('Sign in')) {
      throw new Error(
        'YouTube requires sign-in. This usually means the IP is blocked. ' +
          'Configure a residential proxy in the plugin settings.'
      );
    }

    if (status === 'ERROR' || status === 'UNPLAYABLE') {
      throw new Error(
        `Video is not playable (status: ${status}). ${reason || 'The video may be private, deleted, or unavailable in your region.'}`
      );
    }

    if (status === 'LOGIN_REQUIRED') {
      throw new Error(
        'YouTube requires login to access this video. This usually indicates IP blocking. ' +
          'Configure a residential proxy in the plugin settings.'
      );
    }

    // Check if captions object exists but is empty
    if (info.captions) {
      console.log(`[ai-sdk-transcripts] Video ${videoId} - Captions object exists but no tracks available`);
    } else {
      console.log(`[ai-sdk-transcripts] Video ${videoId} - No captions object in response`);
    }

    throw new Error(
      `No captions available for this video. ` +
        `Playability: ${status || 'Unknown'}. ` +
        `The video may not have captions enabled, or YouTube may be blocking the request. ` +
        (options?.proxyUrl ? '' : 'Try configuring a proxy in the plugin settings.')
    );
  }

  // Log available caption languages
  const availableLanguages = captionTracks.map((t) => `${t.language_code}${t.kind === 'asr' ? ' (auto)' : ''}`);
  console.log(`[ai-sdk-transcripts] Video ${videoId} - Available languages: ${availableLanguages.join(', ')}`);

  // 4. Find English caption track (prefer non-ASR if available)
  const englishTrack =
    captionTracks.find((t) => t.language_code === 'en' && t.kind !== 'asr') ||
    captionTracks.find((t) => t.language_code?.startsWith('en')) ||
    captionTracks[0];

  if (!englishTrack?.base_url) {
    throw new Error('No valid caption track URL found');
  }

  // 5. Fetch timedtext XML
  console.log(`[ai-sdk-transcripts] Video ${videoId} - Fetching caption track: ${englishTrack.language_code}`);
  const xml = await fetchTimedTextXml(englishTrack.base_url, proxyFetch);

  // 6. Parse XML to segments
  const segments = parseTimedTextXml(xml);

  if (segments.length === 0) {
    throw new Error('Failed to parse any transcript segments from XML');
  }

  const transcriptLength = segments.map((s) => s.text).join(' ').length;
  console.log(`[ai-sdk-transcripts] Video ${videoId} - Success! ${segments.length} segments, ${transcriptLength} chars`);

  return {
    videoId,
    title,
    fullTranscript: segments.map((s) => s.text).join(' '),
    transcriptWithTimeCodes: segments,
  };
}

/**
 * Main entry point for fetching YouTube transcripts
 * @param videoId - The YouTube video ID
 * @param options - Optional configuration including proxy settings
 */
const fetchTranscript = async (videoId: string, options?: FetchOptions): Promise<TranscriptData> => {
  try {
    return await fetchTranscriptFromYouTube(videoId, options);
  } catch (error) {
    throw new Error(
      `Failed to fetch transcript for video ${videoId}. ` +
        `The video may not have captions enabled, or may be unavailable. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export default fetchTranscript;
