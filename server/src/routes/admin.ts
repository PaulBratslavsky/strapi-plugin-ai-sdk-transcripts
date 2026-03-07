export default [
  {
    method: 'GET',
    path: '/yt-transcript/:videoId',
    handler: 'controller.getTranscript',
    config: {
      policies: [],
    },
  },
];
