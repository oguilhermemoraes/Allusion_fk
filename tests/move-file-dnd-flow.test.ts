import fse from 'fs-extra';
import { RendererMessenger } from '../src/ipc/renderer';
import { handleMove } from '../src/frontend/containers/Outliner/LocationsPanel/useFileDnD';
import { ClientFile } from '../src/frontend/entities/File';
import { ClientLocation } from '../src/frontend/entities/Location';

// ts-jest emits `require('react').default` (no esModuleInterop in tsconfig),
// so default-imports of React are undefined here. Provide the module object as
// `.default` so context modules (StoreContext, TagDnDContext) can load and run
// their top-level `React.createContext(...)`.
jest.mock('react', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return { ...React, default: React };
});

// Same esModuleInterop quirk for the Node `path` builtin: `handleMove` does
// `import path from 'path'`, which ts-jest compiles to `require('path').default`
// (undefined for the CJS `path` module). Expose the module object as `.default`.
jest.mock('path', () => {
  const Path = jest.requireActual('path') as typeof import('path');
  return { ...Path, default: Path };
});

import path from 'path';

jest.mock('fs-extra', () => {
  const api = {
    pathExists: jest.fn(),
    stat: jest.fn(),
    remove: jest.fn(),
    move: jest.fn(),
  };
  return Object.assign(api, { __esModule: true, default: api });
});
jest.mock('../src/ipc/renderer', () => {
  const api = {
    showMessageBox: jest.fn(),
  };
  return { __esModule: true, default: api, RendererMessenger: api };
});

const mockedFse = fse as unknown as {
  pathExists: jest.Mock;
  stat: jest.Mock;
  remove: jest.Mock;
  move: jest.Mock;
};
const mockedMsgBox = RendererMessenger as unknown as {
  showMessageBox: jest.Mock;
};

const makeFile = (id: string, absolutePath: string) => {
  const name = absolutePath.split('/').pop() ?? absolutePath;
  const filename = name.slice(0, name.lastIndexOf('.'));
  return {
    id,
    absolutePath,
    name,
    filename,
    extension: 'jpg',
    serialize: () => ({
      id,
      absolutePath,
      name,
      filename,
      extension: 'jpg',
      ino: absolutePath,
    }),
  } as unknown as ClientFile;
};
const makeLoc = () => ({ path: path.normalize('C:/dest'), id: 'LOC' } as unknown as ClientLocation);
const makeStore = () =>
  ({
    fileList: [],
    deleteFiles: jest.fn(),
    replaceMovedFile: jest.fn(),
    findFilesByAbsolutePath: jest.fn().mockResolvedValue([]),
    removeFilesByIds: jest.fn().mockResolvedValue(undefined),
  } as any);

describe('handleMove (Replace/Rename/Skip/Cancel flow)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFse.pathExists.mockResolvedValue(false);
    mockedFse.stat.mockResolvedValue({ size: 100 });
    mockedFse.move.mockResolvedValue(undefined);
    mockedFse.remove.mockResolvedValue(undefined);
  });

  test('moves a file to the target dir when it does not exist yet', async () => {
    const fs = makeStore();
    const file = makeFile('1', 'C:/src/a.jpg');
    await handleMove(fs, [file], makeLoc(), 'C:/dest');

    const dst = path.normalize('C:/dest/a.jpg');
    expect(mockedFse.move).toHaveBeenCalledWith(path.normalize('C:/src/a.jpg'), dst, {
      overwrite: true,
    });
    // Record is relocated to the destination path/ino BEFORE the physical move so the
    // watcher (path-based ino on Windows) can't create a duplicate or orphaned file
    expect(fs.replaceMovedFile).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ absolutePath: dst, ino: dst, name: 'a.jpg' }),
    );
    expect(mockedMsgBox.showMessageBox).not.toHaveBeenCalled();
  });

  test('asks user then replaces when the target exists and user confirms', async () => {
    const dstB = path.normalize('C:/dest/b.jpg');
    mockedFse.pathExists.mockImplementation(async (p) => p === dstB);
    mockedMsgBox.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });

    const fs = makeStore();
    const file = makeFile('2', 'C:/src/b.jpg');
    await handleMove(fs, [file], makeLoc(), 'C:/dest');

    expect(mockedMsgBox.showMessageBox).toHaveBeenCalled();
    expect(mockedFse.remove).toHaveBeenCalledWith(dstB);
    expect(mockedFse.move).toHaveBeenCalled();
    expect(fs.replaceMovedFile).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ absolutePath: dstB, ino: dstB }),
    );
  });

  test('renames the file with a numeric suffix when the user picks Rename', async () => {
    const dstB = path.normalize('C:/dest/b.jpg');
    const renamedDst = path.normalize('C:/dest/b (1).jpg');
    mockedFse.pathExists.mockImplementation(async (p) => p === dstB);
    mockedMsgBox.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });

    const fs = makeStore();
    const file = makeFile('2', 'C:/src/b.jpg');
    await handleMove(fs, [file], makeLoc(), 'C:/dest');

    expect(mockedMsgBox.showMessageBox).toHaveBeenCalled();
    // Rename does NOT remove the existing file from disk
    expect(mockedFse.remove).not.toHaveBeenCalledWith(dstB);
    expect(mockedFse.move).toHaveBeenCalledWith(path.normalize('C:/src/b.jpg'), renamedDst, {
      overwrite: true,
    });
    expect(fs.replaceMovedFile).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ absolutePath: renamedDst, ino: renamedDst, name: 'b (1).jpg' }),
    );
  });

  test('skips the file when the user skips', async () => {
    const dstC = path.normalize('C:/dest/c.jpg');
    mockedFse.pathExists.mockImplementation(async (p) => p === dstC);
    mockedMsgBox.showMessageBox.mockResolvedValue({ response: 2, checkboxChecked: false });

    const fs = makeStore();
    const file = makeFile('3', 'C:/src/c.jpg');
    await handleMove(fs, [file], makeLoc(), 'C:/dest');

    expect(mockedFse.move).not.toHaveBeenCalled();
    expect(fs.replaceMovedFile).not.toHaveBeenCalled();
  });

  test('breaks the whole batch when the user cancels', async () => {
    const dstB = path.normalize('C:/dest/b.jpg');
    mockedFse.pathExists.mockImplementation(async (p) => p === dstB);
    mockedMsgBox.showMessageBox.mockResolvedValue({ response: 3, checkboxChecked: false });

    const fs = makeStore();
    await handleMove(fs, [makeFile('2', 'C:/src/b.jpg')], makeLoc(), 'C:/dest');

    expect(mockedFse.move).not.toHaveBeenCalled();
    expect(fs.replaceMovedFile).not.toHaveBeenCalled();
  });

  test('removes stale duplicate records that claim the destination path', async () => {
    const src = 'C:/src/a.jpg';
    const dst = path.normalize('C:/dest/a.jpg');
    const stale = makeFile('OLD', dst);
    mockedFse.pathExists.mockResolvedValue(false);

    const fs = makeStore();
    fs.fileList.push(stale);
    fs.findFilesByAbsolutePath.mockResolvedValue([{ id: 'OLD', absolutePath: dst }]);

    const file = makeFile('1', src);
    await handleMove(fs, [file], makeLoc(), 'C:/dest');

    expect(fs.deleteFiles).toHaveBeenCalledWith([stale]);
    expect(fs.removeFilesByIds).toHaveBeenCalledWith(['OLD']);
    expect(fs.replaceMovedFile).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ absolutePath: dst, ino: dst }),
    );
  });

  test('reverts the record when the physical move fails', async () => {
    const srcD = path.normalize('C:/src/d.jpg');
    mockedFse.move.mockRejectedValueOnce(new Error('move failed'));
    const fs = makeStore();
    const file = makeFile('4', 'C:/src/d.jpg');

    await expect(handleMove(fs, [file], makeLoc(), 'C:/dest')).rejects.toThrow('move failed');

    expect(fs.replaceMovedFile).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ absolutePath: srcD, ino: srcD }),
    );
  });
});
