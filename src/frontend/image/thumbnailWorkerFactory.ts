// Isolated worker-factory module: keeps the `import.meta.url`-based URL
// construction out of `ThumbnailGeneration` so it can be mocked in tests
// (see review note: `window.location.href` breaks webpack bundling).

export const createThumbnailWorkers = (count: number): Worker[] => {
  const workers: Worker[] = [];
  for (let i = 0; i < count; i++) {
    workers.push(
      new Worker(new URL('src/frontend/workers/thumbnailGenerator.worker', import.meta.url)),
    );
  }
  return workers;
};
