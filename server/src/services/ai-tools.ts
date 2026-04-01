import { tools } from '../tools';

export default () => ({
  getTools() {
    return tools;
  },

  getMeta() {
    return {
      label: 'YouTube Transcripts',
      description: 'Fetch, search, list, and read YouTube video transcripts',
      keywords: ['/youtube', '/yt', 'transcript', 'video'],
    };
  },
});
