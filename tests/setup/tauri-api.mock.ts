export const getCurrentWindow = () => ({
  onResized: () => Promise.resolve(() => undefined),
  onFocusChanged: () => Promise.resolve(() => undefined),
  isMaximized: () => Promise.resolve(false),
  isFullscreen: () => Promise.resolve(false),
  setFullscreen: () => Promise.resolve(undefined),
});

export const getCurrentWebview = () => ({
  setZoom: () => Promise.resolve(undefined),
});
