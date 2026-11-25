// Screenshot mode — a small label that tells the user which OS shortcut to use while
// the heatmap is visible. Esc (or a 30s timeout) ends it and calls onExit.

let _screenshotOverlay: HTMLDivElement | null = null;
let _escHandler: ((e: KeyboardEvent) => void) | null = null;
let _autoExitTimer: ReturnType<typeof setTimeout> | null = null;

export function enterScreenshotMode(onExit: () => void): void {
  if (_screenshotOverlay) return;

  // Temporarily set heatmap to full opacity so it reads clearly in the capture
  const heatmapCanvas = document.querySelector<HTMLCanvasElement>('canvas[aria-hidden="true"]');
  const prevOpacity = heatmapCanvas?.style.opacity;
  if (heatmapCanvas) heatmapCanvas.style.opacity = '1';

  const isMac =
    typeof navigator !== 'undefined' &&
    (navigator.platform?.toLowerCase().includes('mac') ||
      (navigator as unknown as { userAgentData?: { platform: string } }).userAgentData?.platform
        ?.toLowerCase()
        .includes('mac'));
  const shortcut = isMac ? 'Cmd+Shift+4' : 'Win+Shift+S';

  // Sits where the minimised pill sits, bottom-right, and is kept short
  _screenshotOverlay = document.createElement('div');
  _screenshotOverlay.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: rgba(24,24,27,0.92);
    color: #fafafa;
    font: 13px/1 system-ui, -apple-system, sans-serif;
    padding: 8px 14px;
    border-radius: 999px;
    z-index: 10001;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
  `;
  _screenshotOverlay.innerHTML = `${shortcut} · <kbd style="background:#3f3f46;padding:1px 5px;border-radius:4px;font:inherit">Esc</kbd> to exit`;
  document.body.appendChild(_screenshotOverlay);

  const exit = () => {
    if (_autoExitTimer !== null) {
      clearTimeout(_autoExitTimer);
      _autoExitTimer = null;
    }
    if (!_screenshotOverlay) return; // already exited
    if (heatmapCanvas && prevOpacity !== undefined) heatmapCanvas.style.opacity = prevOpacity;
    _screenshotOverlay.parentElement?.removeChild(_screenshotOverlay);
    _screenshotOverlay = null;
    if (_escHandler) {
      document.removeEventListener('keydown', _escHandler);
      _escHandler = null;
    }
    onExit();
  };

  _escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') exit();
  };
  document.addEventListener('keydown', _escHandler);

  // Auto-exit after 30 seconds
  _autoExitTimer = setTimeout(exit, 30_000);
}
