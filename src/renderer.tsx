// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

// Import the styles here to let Webpack know to include them
// in the HTML file
import './style.scss';

import fse from 'fs-extra';
import { autorun, reaction } from 'mobx';
import React from 'react';
import { Root, createRoot } from 'react-dom/client';

import { IS_DEV } from 'common/process';
import { WINDOW_STORAGE_KEY } from 'common/window';
import { RendererMessenger } from 'src/ipc/renderer';
import { DataBackup } from './api/data-backup';
import { DataStorage } from './api/data-storage';
import Backend from './backend/backend';
import BackupScheduler from './backend/backup-scheduler';
import { DB_NAME, dbInit } from './backend/config';
import SqliteBackend from './backend/sqlite-backend';
import App from './frontend/App';
import StoreProvider from './frontend/contexts/StoreContext';
import Overlay from './frontend/Overlay';
import { FILE_STORAGE_KEY } from './frontend/stores/FileStore';
import RootStore from './frontend/stores/RootStore';
import { PREFERENCES_STORAGE_KEY } from './frontend/stores/UiStore';

const STORAGE_MODE_KEY = 'allusion.storage';

async function main(): Promise<void> {
  // Render our react components in the div with id 'app' in the html file
  const container = document.getElementById('app');

  if (container === null) {
    throw new Error('Unable to create user interface.');
  }

  const root = createRoot(container);

  performance.mark('renderer-start');

  const storageMode = localStorage.getItem(STORAGE_MODE_KEY);
  if (storageMode === 'sqlite') {
    const noopBackup: DataBackup = {
      schedule: () => {},
      backupToFile: async () => {},
      restoreFromFile: async () => {},
      peekFile: async () => [0, 0],
    };
    const backend = await SqliteBackend.init(() => noopBackup.schedule());
    await runMainApp(backend, noopBackup, root);
  } else {
    const db = dbInit(DB_NAME);
    const defaultBackupDirectory = await RendererMessenger.getDefaultBackupDirectory();
    const backup = new BackupScheduler(db, defaultBackupDirectory);
    const [backend] = await Promise.all([
      Backend.init(db, () => backup.schedule()),
      fse.ensureDir(defaultBackupDirectory),
    ]);
    await runMainApp(backend, backup, root);
  }
}

async function runMainApp(backend: DataStorage, backup: DataBackup, root: Root): Promise<void> {
  const rootStore = await RootStore.main(backend, backup);

  // Recover global preferences
  try {
    const window_preferences = localStorage.getItem(WINDOW_STORAGE_KEY);
    if (window_preferences === null) {
      localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify({ isFullScreen: false }));
    } else {
      const prefs = JSON.parse(window_preferences);
      if (prefs.isFullScreen === true) {
        RendererMessenger.setFullScreen(true);
        rootStore.uiStore.setFullScreen(true);
      }
    }
  } catch (e) {
    console.error('Cannot load window preferences', e);
  }

  // Debounced and automatic storing of preferences
  reaction(
    () => rootStore.fileStore.getPersistentPreferences(),
    (preferences) => {
      localStorage.setItem(FILE_STORAGE_KEY, JSON.stringify(preferences));
    },
    { delay: 200 },
  );

  reaction(
    () => rootStore.uiStore.getPersistentPreferences(),
    (preferences) => {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    },
    { delay: 200 },
  );

  autorun(() => {
    document.title = rootStore.getWindowTitle();
  });

  root.render(
    <StoreProvider value={rootStore}>
      <App />
      <Overlay />
    </StoreProvider>,
  );

  performance.mark('ui-ready');
  console.log(
    `[PERF] UI ready in ${performance
      .measure('ui-render', 'renderer-start', 'ui-ready')
      .duration.toFixed(2)}ms`,
  );

  // -------------------------------------------
  // Messaging with the main process
  // -------------------------------------------

  RendererMessenger.onFullScreenChanged((val) => rootStore.uiStore.setFullScreen(val));

  // Runs operations to run before closing the app, e.g. closing child-processes
  window.addEventListener('beforeunload', () => {
    rootStore.close();
  });
}

main()
  .then(() => console.info('Successfully initialized Allusion!'))
  .catch((err) => {
    console.error('Could not initialize Allusion!', err);
    // The window is created hidden (`visible: false`): reveal it before showing the
    // error dialog, so a failed initialization is visible instead of an invisible hang.
    RendererMessenger.initialized();
    window.alert('An error has occurred, check the console for more details');

    // In dev mode, the console is already automatically opened: only open in non-dev mode here
    if (!IS_DEV) {
      RendererMessenger.toggleDevTools();
    }
  });
