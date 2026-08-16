import React, { useCallback, useState } from 'react';
import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import { AppToaster } from '../../components/Toaster';
import { useStore } from '../../contexts/StoreContext';
import { ClientFile } from '../../entities/File';

interface RenameFileDialogProps {
  open: boolean;
  file: ClientFile | null;
  onClose: () => void;
}

export const RenameFileDialog = ({ open, file, onClose }: RenameFileDialogProps) => {
  const { fileStore } = useStore();
  const [fileName, setFileName] = useState(file?.filename || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (file) {
      setFileName(file.filename);
    }
  }, [file, open]);

  const handleSubmit = useCallback(async () => {
    if (!file) {
      return;
    }
    const trimmed = fileName.trim();
    if (!trimmed || trimmed === file.filename) {
      onClose();
      return;
    }
    setIsSubmitting(true);
    try {
      await fileStore.renameFile(file, trimmed);
      onClose();
      AppToaster.show({
        message: `File renamed to "${trimmed}.${file.extension}".`,
        timeout: 3000,
      });
    } catch (err: any) {
      AppToaster.show({ message: `Failed to rename file: ${err.message || err}`, timeout: 5000 });
    } finally {
      setIsSubmitting(false);
    }
  }, [fileName, file, fileStore, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  if (!file) {
    return null;
  }

  return (
    <Dialog
      open={open}
      title="Rename File"
      icon={IconSet.EDIT}
      onCancel={onClose}
      onClose={onClose}
    >
      <div
        className="dialog-body"
        style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-color-secondary)' }}>
          Enter a new name for the file:
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Filename"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <span style={{ color: 'var(--text-color-secondary)', fontSize: '13px' }}>
            .{file.extension}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
          <Button text="Cancel" onClick={onClose} />
          <Button
            text="Rename"
            styling="filled"
            onClick={handleSubmit}
            disabled={!fileName.trim() || fileName.trim() === file.filename || isSubmitting}
          />
        </div>
      </div>
    </Dialog>
  );
};
