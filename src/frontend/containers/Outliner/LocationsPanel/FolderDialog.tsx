import React, { useCallback, useState } from 'react';
import { Button, IconSet } from 'widgets';
import { Dialog } from 'widgets/popovers';
import { AppToaster } from '../../../components/Toaster';
import { useStore } from '../../../contexts/StoreContext';

interface CreateFolderDialogProps {
  open: boolean;
  parentPath: string;
  onClose: () => void;
}

export const CreateFolderDialog = ({ open, parentPath, onClose }: CreateFolderDialogProps) => {
  const { locationStore } = useStore();
  const [folderName, setFolderName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmed = folderName.trim();
    if (!trimmed) {
      return;
    }
    setIsSubmitting(true);
    try {
      await locationStore.createSubFolder(parentPath, trimmed);
      setFolderName('');
      onClose();
      AppToaster.show({ message: `Folder "${trimmed}" created successfully.`, timeout: 3000 });
    } catch (err: any) {
      AppToaster.show({ message: `Failed to create folder: ${err.message || err}`, timeout: 5000 });
    } finally {
      setIsSubmitting(false);
    }
  }, [folderName, locationStore, parentPath, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <Dialog
      open={open}
      title="Create New Folder"
      icon={IconSet.ADD}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="dialog-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-color-secondary)' }}>
          Create a new subfolder inside: <strong style={{ color: 'var(--text-color)' }}>{parentPath}</strong>
        </p>
        <input
          className="input"
          placeholder="Folder name"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
          <Button text="Cancel" onClick={onClose} />
          <Button
            text="Create"
            styling="filled"
            onClick={handleSubmit}
            disabled={!folderName.trim() || isSubmitting}
          />
        </div>
      </div>
    </Dialog>
  );
};

interface RenameFolderDialogProps {
  open: boolean;
  currentPath: string;
  currentName: string;
  onClose: () => void;
}

export const RenameFolderDialog = ({
  open,
  currentPath,
  currentName,
  onClose,
}: RenameFolderDialogProps) => {
  const { locationStore } = useStore();
  const [folderName, setFolderName] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    setFolderName(currentName);
  }, [currentName, open]);

  const handleSubmit = useCallback(async () => {
    const trimmed = folderName.trim();
    if (!trimmed || trimmed === currentName) {
      onClose();
      return;
    }
    setIsSubmitting(true);
    try {
      await locationStore.renameFolder(currentPath, trimmed);
      onClose();
      AppToaster.show({ message: `Folder renamed to "${trimmed}".`, timeout: 3000 });
    } catch (err: any) {
      AppToaster.show({ message: `Failed to rename folder: ${err.message || err}`, timeout: 5000 });
    } finally {
      setIsSubmitting(false);
    }
  }, [folderName, currentName, locationStore, currentPath, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <Dialog
      open={open}
      title="Rename Folder"
      icon={IconSet.EDIT}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="dialog-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-color-secondary)' }}>
          Enter a new name for the folder:
        </p>
        <input
          className="input"
          placeholder="Folder name"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
          <Button text="Cancel" onClick={onClose} />
          <Button
            text="Rename"
            styling="filled"
            onClick={handleSubmit}
            disabled={!folderName.trim() || folderName.trim() === currentName || isSubmitting}
          />
        </div>
      </div>
    </Dialog>
  );
};
