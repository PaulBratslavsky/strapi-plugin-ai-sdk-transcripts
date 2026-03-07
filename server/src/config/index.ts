export default {
  default: {
    proxyUrl: '', // Optional: HTTP/HTTPS proxy for YouTube requests (e.g., 'http://user:pass@proxy.example.com:8080')
    chunkSizeSeconds: 300, // Default chunk size for transcript pagination (5 minutes)
    previewLength: 500, // Default preview length in characters
    maxFullTranscriptLength: 50000, // Auto-load full transcript if under this character count (~12K tokens)
    searchSegmentSeconds: 30, // Segment size for BM25 search scoring
  },
  validator(config: {
    proxyUrl?: string;
    chunkSizeSeconds?: number;
    previewLength?: number;
    maxFullTranscriptLength?: number;
    searchSegmentSeconds?: number;
  }) {
    if (config.proxyUrl && typeof config.proxyUrl !== 'string') {
      throw new Error('proxyUrl must be a string');
    }
    if (config.chunkSizeSeconds !== undefined && (typeof config.chunkSizeSeconds !== 'number' || config.chunkSizeSeconds < 30)) {
      throw new Error('chunkSizeSeconds must be a number >= 30');
    }
    if (config.previewLength !== undefined && (typeof config.previewLength !== 'number' || config.previewLength < 100)) {
      throw new Error('previewLength must be a number >= 100');
    }
    if (config.maxFullTranscriptLength !== undefined && (typeof config.maxFullTranscriptLength !== 'number' || config.maxFullTranscriptLength < 1000)) {
      throw new Error('maxFullTranscriptLength must be a number >= 1000');
    }
    if (config.searchSegmentSeconds !== undefined && (typeof config.searchSegmentSeconds !== 'number' || config.searchSegmentSeconds < 10)) {
      throw new Error('searchSegmentSeconds must be a number >= 10');
    }
  },
};
