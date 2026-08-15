import React, { useEffect, useState } from 'react';

import { isTauri } from 'common/tauri';

/**
 * Shows a small "Inspect / Reload" context menu on right-click in areas the app
 * doesn't handle itself (skip when an app context menu already prevented the
 * default). Only active in Tauri, where the WebView2 default menu has no
 * DevTools entry.
 */
const DevToolsContextMenu: React.FC = () => {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) {
        return;
      }
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };

    const onPointerDown = (e: MouseEvent) => {
      if (menu && !(e.target as HTMLElement).closest('.devtools-context-menu')) {
        setMenu(null);
      }
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menu]);

  if (!menu) {
    return null;
  }

  return (
    <div
      className="devtools-context-menu"
      style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 99999 }}
      onClick={() => setMenu(null)}
    >
      <button
        type="button"
        onClick={() => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { invoke } = require('@tauri-apps/api/core');
          invoke('open_devtools').catch(() => {});
        }}
      >
        Inspect
      </button>
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload
      </button>
    </div>
  );
};

export default DevToolsContextMenu;
