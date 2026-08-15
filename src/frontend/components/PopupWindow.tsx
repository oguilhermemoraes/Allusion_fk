import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { isTauri } from 'common/tauri';
import Overlay from '../Overlay';

const PLATFORM = process.platform;
type PopupWindowProps = {
  children: React.ReactNode;
  onClose: () => void;
  windowName: string;
  closeOnEscape?: boolean;
  additionalCloseKey?: string;
};

/**
 * Creates a new external browser window, that renders whatever you pass as children
 */
const PopupWindow: React.FC<PopupWindowProps> = (props) => {
  const [containerEl] = useState(document.createElement('div'));
  const [win, setWin] = useState<Window>();
  const [inline, setInline] = useState(false);

  useEffect(() => {
    // In Tauri/WebView2, `window.open` spawns an unmanaged popup at the top-left
    // corner of the screen, so external popup windows are not supported there.
    // Fall back to rendering the content as a full-viewport inline overlay in
    // the main window instead.
    let externalWindow: Window | null = null;
    if (!isTauri()) {
      try {
        externalWindow = window.open('', props.windowName);
      } catch {
        externalWindow = null;
      }
    }

    if (!externalWindow) {
      document.body.appendChild(containerEl);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === props.additionalCloseKey) {
          props.onClose();
        }
      };
      if (props.closeOnEscape) {
        document.addEventListener('keydown', onKey);
      }
      window.addEventListener('beforeunload', props.onClose);
      setInline(true);
      return function cleanup() {
        containerEl.remove();
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('beforeunload', props.onClose);
      };
    }

    setWin(externalWindow);

    externalWindow.document.body.appendChild(containerEl);

    // Copy style sheets from main window
    copyStyles(document, externalWindow.document);
    containerEl.setAttribute('data-os', PLATFORM);

    // Hacky func for re-applying CSS to settings when changing that of the main window
    (window as any).reapplyPopupStyles = () => {
      copyStyles(document, externalWindow!.document);
    };

    externalWindow.addEventListener('beforeunload', props.onClose);

    if (props.closeOnEscape) {
      externalWindow.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === props.additionalCloseKey) {
          props.onClose();
        }
      });
    }

    return function cleanup() {
      externalWindow!.close();
      setWin(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (win) {
    return ReactDOM.createPortal(
      <>
        {props.children}
        <Overlay document={win.document} />
      </>,
      containerEl,
    );
  }
  if (inline) {
    return ReactDOM.createPortal(
      <div className="popup-window-inline">
        <div className="popup-window-modal">
          <button
            type="button"
            className="popup-window-close"
            aria-label="Close"
            onClick={props.onClose}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4L10.6 12l-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z"
              />
            </svg>
          </button>
          {props.children}
          <Overlay document={document} />
        </div>
      </div>,
      containerEl,
    );
  }
  return null;
};

export default PopupWindow;

function copyStyles(sourceDoc: Document, targetDoc: Document) {
  // First clear any existing styles
  ['style', 'link'].forEach((t) =>
    Array.from(targetDoc.getElementsByTagName(t)).forEach((i) => i.parentElement?.removeChild(i)),
  );

  for (let i = 0; i < sourceDoc.styleSheets.length; i++) {
    const styleSheet = sourceDoc.styleSheets[i];
    // production mode bundles CSS in one file
    if (styleSheet.href) {
      const linkElement = targetDoc.createElement('link');
      linkElement.rel = 'stylesheet';
      linkElement.href = styleSheet.href;
      targetDoc.head.appendChild(linkElement);
      // development mode injects style elements for CSS
    } else if (styleSheet.cssRules.length > 0) {
      const styleElement = targetDoc.createElement('style');
      for (let i = 0; i < styleSheet.cssRules.length; i++) {
        const cssRule = styleSheet.cssRules[i];
        styleElement.appendChild(targetDoc.createTextNode(cssRule.cssText));
      }
      targetDoc.head.appendChild(styleElement);
    }
  }
}
