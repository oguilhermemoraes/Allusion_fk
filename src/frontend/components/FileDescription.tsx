import React, { useState } from 'react';

import { ClientFile } from '../entities/File';

/**
 * Editable free-text description for a single file. Saved on blur via the same
 * auto-save reaction used for tags (#49). The parent passes a `key={file.id}`
 * so the local state is reset whenever the selected file changes.
 */
const FileDescription = ({ file }: { file: ClientFile }) => {
  const [text, setText] = useState(file.description ?? '');

  const handleBlur = () => {
    if (text !== file.description) {
      file.setDescription(text);
    }
  };

  return (
    <textarea
      className="input multiline file-description"
      value={text}
      placeholder="No description yet"
      aria-label="Description"
      rows={4}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
    />
  );
};

export default FileDescription;
