import React, { ReactNode } from 'react';
import { RendererMessenger } from 'src/ipc/renderer';

export type OpenDialogOptions = {
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

type FileInputProps = {
  onChange: (value: [string, ...string[]]) => void;
  options: OpenDialogOptions;
  children: ReactNode;
  className?: string;
};

const FileInput = ({ onChange, options, children, className }: FileInputProps) => {
  const handleChange = async () => {
    try {
      const { filePaths } = await RendererMessenger.showOpenDialog(options);

      if (filePaths.length > 0) {
        onChange(filePaths as [string, ...string[]]);
      }
    } catch (error) {
      // TODO: Show error notification.
      console.error(error);
      return;
    }
  };

  return (
    <button className={className} onClickCapture={handleChange}>
      {children}
    </button>
  );
};

export default FileInput;
