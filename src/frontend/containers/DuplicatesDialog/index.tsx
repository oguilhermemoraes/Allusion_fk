import React, { useCallback, useMemo, useState } from 'react';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { ellipsize, humanFileSize } from 'common/fmt';
import { encodeFilePath } from 'common/fs';
import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import { AppToaster } from '../../components/Toaster';
import { useStore } from '../../contexts/StoreContext';
import { ClientFile } from '../../entities/File';
import { DuplicateGroupDTO, DuplicateItemDTO, RendererMessenger } from '../../../ipc/renderer';

interface DuplicatesDialogProps {
  open: boolean;
  onClose: () => void;
}

export const DuplicatesDialog = observer(({ open, onClose }: DuplicatesDialogProps) => {
  const { fileStore } = useStore();

  const [maxDistance, setMaxDistance] = useState<number>(0);
  const [isScanning, setIsScanning] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroupDTO[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [hasScanned, setHasScanned] = useState(false);

  // Map of absolutePath -> ClientFile for fast lookup of dimensions, size, etc.
  const fileMap = useMemo(() => {
    const map = new Map<string, ClientFile>();
    fileStore.fileList.forEach((f) => {
      map.set(f.absolutePath, f);
    });
    return map;
  }, [fileStore.fileList]);

  const handleScan = useCallback(async () => {
    // Reading the observable `fileList` / `file.isBroken` here happens in a
    // click handler (not a reactive context): without runInAction, MobX
    // (`observableRequiresReaction`) emits one warning PER FILE — thousands of
    // console warnings when scanning a large library (#80).
    const paths = runInAction(() =>
      fileStore.fileList.filter((f) => !f.isBroken).map((f) => f.absolutePath),
    );

    if (paths.length === 0) {
      AppToaster.show({ message: 'No images available to scan.', timeout: 3000 });
      return;
    }

    setIsScanning(true);
    setHasScanned(true);
    try {
      const results = await RendererMessenger.findDuplicateImages(paths, maxDistance);
      setGroups(results);
      setSelectedPaths(new Set());
      if (results.length === 0) {
        AppToaster.show({ message: 'No duplicate images found.', timeout: 3000 });
      } else {
        const totalDupes = results.reduce((acc, g) => acc + g.files.length, 0);
        AppToaster.show({
          message: `Found ${results.length} duplicate groups (${totalDupes} images total).`,
          timeout: 4000,
        });
      }
    } catch (err: any) {
      AppToaster.show({
        message: `Failed to scan duplicates: ${err.message || err}`,
        timeout: 5000,
      });
    } finally {
      setIsScanning(false);
    }
  }, [fileStore.fileList, maxDistance]);

  const togglePathSelection = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const autoSelectDuplicates = useCallback(
    (criterion: 'resolution' | 'size') => {
      const newSelected = new Set<string>();

      groups.forEach((group) => {
        if (group.files.length < 2) {
          return;
        }

        // Find best item according to criterion
        let bestIndex = 0;
        let bestVal = -1;

        group.files.forEach((item, idx) => {
          const file = fileMap.get(item.path);
          let val = 0;
          if (file) {
            if (criterion === 'resolution') {
              val = (file.width || 0) * (file.height || 0);
            } else {
              val = file.size || 0;
            }
          }
          if (val > bestVal) {
            bestVal = val;
            bestIndex = idx;
          }
        });

        // Mark all except best
        group.files.forEach((item, idx) => {
          if (idx !== bestIndex) {
            newSelected.add(item.path);
          }
        });
      });

      setSelectedPaths(newSelected);
      AppToaster.show({
        message: `Selected ${newSelected.size} duplicate files to remove (kept highest ${criterion}).`,
        timeout: 3000,
      });
    },
    [groups, fileMap],
  );

  const handleMoveSelectedToTrash = useCallback(async () => {
    if (selectedPaths.size === 0) {
      return;
    }

    const filesToTrash = Array.from(selectedPaths)
      .map((p) => fileMap.get(p))
      .filter((f): f is ClientFile => Boolean(f));

    if (filesToTrash.length === 0) {
      return;
    }

    try {
      const deletedFiles: ClientFile[] = [];
      for (const file of filesToTrash) {
        const error = await RendererMessenger.trashFile(file.absolutePath);
        if (!error) {
          deletedFiles.push(file);
        }
      }
      fileStore.deleteFiles(deletedFiles);
      const count = deletedFiles.length;

      // Filter removed paths out of groups
      setGroups((prevGroups) =>
        prevGroups
          .map((g) => ({
            ...g,
            files: g.files.filter((f) => !selectedPaths.has(f.path)),
          }))
          .filter((g) => g.files.length >= 2),
      );
      setSelectedPaths(new Set());

      AppToaster.show({
        message: `Moved ${count} duplicate image(s) to trash.`,
        timeout: 4000,
      });
    } catch (err: any) {
      AppToaster.show({
        message: `Error moving duplicates to trash: ${err.message || err}`,
        timeout: 5000,
      });
    }
  }, [fileMap, fileStore, selectedPaths]);

  if (!open) {
    return null;
  }

  return (
    <Dialog
      open={open}
      title="Find Duplicate Images"
      icon={IconSet.SEARCH}
      onCancel={onClose}
      onClose={onClose}
    >
      <div
        className="dialog-body"
        style={{
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          maxHeight: '75vh',
          minWidth: '580px',
        }}
      >
        {/* Controls Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            paddingBottom: '12px',
            borderBottom: '1px solid var(--border-color, rgba(0,0,0,0.1))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-color-secondary)' }}>
              Similarity:
            </span>
            <select
              className="select"
              value={maxDistance}
              onChange={(e) => setMaxDistance(Number(e.target.value))}
              disabled={isScanning}
              style={{ padding: '4px 8px', fontSize: '13px' }}
            >
              <option value={0}>Exact Duplicates (distance 0)</option>
              <option value={5}>Very Similar / Re-saves (distance &le; 5)</option>
              <option value={10}>Loose Similar (distance &le; 10)</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {groups.length > 0 && (
              <Button
                text="Select Duplicates (Keep Best Res)"
                onClick={() => autoSelectDuplicates('resolution')}
                disabled={isScanning}
              />
            )}
            <Button
              text={isScanning ? 'Scanning...' : 'Scan Duplicates'}
              styling="filled"
              onClick={handleScan}
              disabled={isScanning}
            />
          </div>
        </div>

        {/* Results Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            minHeight: '220px',
          }}
        >
          {isScanning && (
            <div
              style={{ padding: '32px', textAlign: 'center', color: 'var(--text-color-secondary)' }}
            >
              Computing perceptual hashes across library...
            </div>
          )}

          {!isScanning && hasScanned && groups.length === 0 && (
            <div
              style={{ padding: '32px', textAlign: 'center', color: 'var(--text-color-secondary)' }}
            >
              No duplicate images found with the selected similarity threshold.
            </div>
          )}

          {!isScanning && !hasScanned && (
            <div
              style={{ padding: '32px', textAlign: 'center', color: 'var(--text-color-secondary)' }}
            >
              Click &quot;Scan Duplicates&quot; to analyze loaded images and detect duplicate or
              resized versions.
            </div>
          )}

          {!isScanning &&
            groups.map((group, groupIdx) => (
              <div
                key={group.hash + groupIdx}
                style={{
                  border: '1px solid var(--border-color, rgba(0,0,0,0.1))',
                  borderRadius: '6px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  backgroundColor: 'var(--surface-color, rgba(0,0,0,0.02))',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-color-secondary)',
                  }}
                >
                  <span>
                    Group #{groupIdx + 1} ({group.files.length} images)
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                    Hash: {group.hash.slice(0, 8)}...
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: '10px',
                  }}
                >
                  {group.files.map((item: DuplicateItemDTO) => {
                    const file = fileMap.get(item.path);
                    const isSelected = selectedPaths.has(item.path);
                    const imgSrc = file
                      ? encodeFilePath(file.thumbnailPath || file.absolutePath)
                      : '';

                    return (
                      <div
                        key={item.path}
                        onClick={() => togglePathSelection(item.path)}
                        style={{
                          border: isSelected
                            ? '2px solid var(--danger-color, #e53e3e)'
                            : '1px solid var(--border-color, rgba(0,0,0,0.1))',
                          borderRadius: '4px',
                          padding: '8px',
                          cursor: 'pointer',
                          backgroundColor: isSelected
                            ? 'var(--danger-bg, rgba(229, 62, 62, 0.08))'
                            : 'var(--card-bg, #fff)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div
                          style={{
                            height: '110px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            backgroundColor: 'rgba(0,0,0,0.04)',
                            borderRadius: '3px',
                          }}
                        >
                          {imgSrc ? (
                            <img
                              src={imgSrc}
                              alt={file?.name || 'Image'}
                              style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                            />
                          ) : (
                            <span>{IconSet.MEDIA}</span>
                          )}
                        </div>

                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {file?.name || ellipsize(item.path, 25)}
                        </div>

                        <div
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-color-secondary)',
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>{file ? `${file.width}×${file.height}` : '—'}</span>
                          <span>{file ? humanFileSize(file.size) : '—'}</span>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            marginTop: '2px',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}} // Handled by container onClick
                            style={{ margin: 0 }}
                          />
                          <span
                            style={{
                              fontSize: '11px',
                              color: isSelected ? 'var(--danger-color, #e53e3e)' : 'inherit',
                            }}
                          >
                            {isSelected ? 'Marked for deletion' : 'Keep file'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-color, rgba(0,0,0,0.1))',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-color-secondary)' }}>
            {selectedPaths.size > 0
              ? `${selectedPaths.size} file(s) selected for deletion.`
              : `${groups.length} duplicate group(s) found.`}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button text="Close" onClick={onClose} />
            {selectedPaths.size > 0 && (
              <Button
                text={`Move ${selectedPaths.size} to Trash`}
                styling="filled"
                onClick={handleMoveSelectedToTrash}
              />
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
});
