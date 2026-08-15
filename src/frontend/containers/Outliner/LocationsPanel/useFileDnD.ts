import { humanFileSize } from 'common/fmt';
import fse from 'fs-extra';
import path from 'path';
import { useCallback, useState } from 'react';

import { RendererMessenger } from '../../../../ipc/renderer';
import { AppToaster } from '../../../components/Toaster';
import { useStore } from '../../../contexts/StoreContext';
import { DnDAttribute, DnDFileType } from '../../../contexts/TagDnDContext';
import { ClientFile } from '../../../entities/File';
import { ClientLocation } from '../../../entities/Location';
import FileStore from '../../../stores/FileStore';
import { IExpansionState } from '../../types';
import {
  findDroppedFileMatches,
  getDropData,
  handleDragLeave,
  isAcceptableType,
  onDragOver,
  storeDroppedImage,
} from './dnd';

export const HOVER_TIME_TO_EXPAND = 600;

/**
 * Either moves or downloads a dropped file into the target directory
 * @param fileStore
 * @param matches
 * @param dir
 */
export const handleMove = async (
  fileStore: FileStore,
  matches: ClientFile[],
  loc: ClientLocation,
  dir: string,
) => {
  let applyAllAction: 'replace' | 'rename' | 'skip' | undefined;

  // If it's a file being dropped that's already in Allusion, move it
  for (const file of matches) {
    const src = path.normalize(file.absolutePath);
    let dst = path.normalize(path.join(dir, file.name));
    if (src === dst) {
      continue;
    }

    const alreadyExists = await fse.pathExists(dst);

    // When the destination already contains a file with the same name, ask the user
    // whether to replace, auto-rename, or skip it
    if (alreadyExists) {
      let action: 'replace' | 'rename' | 'skip';
      if (applyAllAction) {
        action = applyAllAction;
      } else {
        const srcStats = await fse.stat(src);
        const dstStats = await fse.stat(dst);

        // if the file is already in the target location, prompt the user to confirm the move
        // TODO: could also add option to rename with a number suffix?
        const res = await RendererMessenger.showMessageBox({
          type: 'question',
          title: 'Replace, rename or skip file?',
          message: `"${file.name}" already exists in this folder. How do you want to move it?`,
          detail: `From "${path.dirname(file.absolutePath)}" (${humanFileSize(
            srcStats.size,
          )}) \nTo      "${dir}" (${humanFileSize(
            dstStats.size,
          )})\n\nReplace overwrites the existing file (its tags will be lost).\nRename moves it as "${
            file.filename
          } (1)${path.extname(file.name)}" and keeps both.\nSkip leaves the file where it is.`,
          buttons: ['&Replace', '&Rename', '&Skip', '&Cancel'],
          normalizeAccessKeys: true,
          defaultId: 0,
          cancelId: 3,
          checkboxLabel: matches.length > 1 ? 'Apply to all' : undefined,
        });

        if (res.response === 3) {
          break; // cancel the whole operation
        }
        action = res.response === 1 ? 'rename' : res.response === 2 ? 'skip' : 'replace';
        if (res.checkboxChecked) {
          applyAllAction = action;
        }
      }

      if (action === 'skip') {
        continue;
      } else if (action === 'rename') {
        dst = await getUniqueDestination(fse, dir, file.name);
      } else {
        // When replacing an existing file, no change is detected when moving the file.
        // The target file needs to be removed from disk and the DB first
        // - Remove the target file from disk
        await fse.remove(dst);

        // - Remove the target file from the store
        // TODO: This removes the target file and its tags. Could merge them, but that's a bit more work
        const dstFile = fileStore.fileList.find((f) => f.absolutePath === dst);
        if (dstFile) {
          await fileStore.deleteFiles([dstFile]);
        }

        // We need to wait a second for the UI to update, otherwise it will cause render issues for some reason (old and new are rendered simultaneously)
        await new Promise((res) => setTimeout(res, 1000));
      }
    }

    // Remove any stale records that already claim the destination path (duplicates left
    // behind by pre-fix moves, before files were relocated on the track of the watcher).
    // The `files` table has a unique `&absolutePath` index, so saving the relocated record
    // would otherwise throw a Dexie ConstraintError and the DB would keep pointing at the
    // old (now non-existing) path, showing the moved files as "missing" in the old folder.
    await removeStaleDuplicateRecords(fileStore, dst, file.id);

    // Relocate the file's DB record to the target path BEFORE moving the file on disk.
    // On Windows the Tauri `ino` falls back to the absolute path (see fs-shim get_file_info),
    // so it changes on every move: the watcher's "addFile" can never match the existing
    // record and would create a duplicate while leaving a broken orphan at the source.
    // Since the app knows the exact destination, update the record directly (same id, so
    // tags/selection are preserved); the watcher events for the moved file then become no-ops
    // because the record already points to `dst`.
    const oldFile = file.serialize();
    fileStore.replaceMovedFile(file, {
      ...oldFile,
      ino: dst,
      name: path.basename(dst),
      absolutePath: dst,
      relativePath: dst.replace(loc.path, ''),
      locationId: loc.id,
      dateModified: new Date(),
    });

    try {
      await fse.move(src, dst, { overwrite: true });
    } catch (err) {
      // Revert the record so the app stays consistent with the failed move
      fileStore.replaceMovedFile(file, {
        ...oldFile,
        ino: src,
        absolutePath: src,
        relativePath: oldFile.relativePath,
        locationId: oldFile.locationId,
        dateModified: oldFile.dateModified,
      });
      throw err;
    }
  }
};

/**
 * Finds an unused path in `dir` by appending a numeric suffix to the file name,
 * e.g. "image.jpg" -> "image (1).jpg", "image (2).jpg", ...
 */
async function getUniqueDestination(
  fse: typeof import('fs-extra'),
  dir: string,
  name: string,
): Promise<string> {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let suffix = 1; ; suffix++) {
    const candidate = path.normalize(path.join(dir, `${base} (${suffix})${ext}`));
    if (!(await fse.pathExists(candidate))) {
      return candidate;
    }
  }
}

/** Deletes any records (from the fileList and the DB) that currently point to `dst`. */
async function removeStaleDuplicateRecords(
  fileStore: FileStore,
  dst: string,
  movingFileId: string,
): Promise<void> {
  const staleInList = fileStore.fileList.filter(
    (f) => f.absolutePath === dst && f.id !== movingFileId,
  );
  if (staleInList.length > 0) {
    // deleteFiles() also triggers a full refetch; the DB leftovers are removed below
    await fileStore.deleteFiles(staleInList);
  }

  const staleInDb = await fileStore.findFilesByAbsolutePath(dst);
  const staleInDbIds = staleInDb.filter((f) => f.id !== movingFileId).map((f) => f.id);
  if (staleInDbIds.length > 0) {
    await fileStore.removeFilesByIds(staleInDbIds);
  }
}

export const useFileDropHandling = (
  expansionId: string,
  fullPath: string,
  expansion: IExpansionState,
  setExpansion: (s: IExpansionState) => void,
) => {
  const { fileStore, locationStore } = useStore();
  // Don't expand immediately, only after hovering over it for a second or so
  const [expandTimeoutId, setExpandTimeoutId] = useState<number>();
  const expandDelayed = useCallback(() => {
    if (expandTimeoutId) {
      clearTimeout(expandTimeoutId);
    }
    const t = window.setTimeout(() => {
      setExpansion({ ...expansion, [expansionId]: true });
    }, HOVER_TIME_TO_EXPAND);
    setExpandTimeoutId(t);
  }, [expandTimeoutId, expansion, expansionId, setExpansion]);

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      // Skip events intended for different handlers
      if (
        !event.dataTransfer.types.includes('Files') &&
        !event.dataTransfer.types.includes(DnDFileType)
      ) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      const canDrop = onDragOver(event);
      if (canDrop && !expansion[expansionId]) {
        expandDelayed();
      }
    },
    [expansion, expansionId, expandDelayed, fullPath],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.currentTarget.dataset[DnDAttribute.Target] = 'false';

      if (isAcceptableType(event)) {
        event.dataTransfer.dropEffect = 'none';
        try {
          const dropData = await getDropData(event);

          // if this is a local file (it has matches to the files in the DB),
          // it should be moved instead of copied
          const matches = findDroppedFileMatches(dropData, fileStore);
          if (matches) {
            const loc = locationStore.locationList.find((l) => fullPath.startsWith(l.path));
            if (!loc) {
              throw new Error('Location not found for path ' + fullPath);
            }
            await handleMove(fileStore, matches, loc, fullPath);
            setTimeout(() => fileStore.refetch(), 500);
          } else {
            // Otherwise it's an external file (e.g. from the web or a folder not set up as a Location in Allusion)
            // -> download it and "copy" it to the target folder
            await storeDroppedImage(dropData, fullPath);
          }
        } catch (e) {
          console.error(e);
          AppToaster.show({
            message: 'Something went wrong, could not import image :(',
            timeout: 4000,
          });
        }
      } else {
        AppToaster.show({ message: 'File type not supported :(', timeout: 4000 });
      }
    },
    [fullPath, fileStore, locationStore],
  );

  const handleDragLeaveWrapper = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      // Drag events are also triggered for children??
      // We don't want to detect dragLeave of a child as a dragLeave of the target element, so return immmediately
      if ((event.target as HTMLElement).contains(event.relatedTarget as HTMLElement)) {
        return;
      }

      // Skip events intended for different handlers
      if (
        !event.dataTransfer.types.includes('Files') &&
        !event.dataTransfer.types.includes(DnDFileType)
      ) {
        return;
      }

      event.stopPropagation();
      event.preventDefault();
      handleDragLeave(event);
      if (expandTimeoutId) {
        clearTimeout(expandTimeoutId);
        setExpandTimeoutId(undefined);
      }
    },
    [expandTimeoutId],
  );

  return {
    handleDragEnter,
    handleDrop,
    handleDragLeave: handleDragLeaveWrapper,
  };
};
