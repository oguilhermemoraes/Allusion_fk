import React from 'react';
import { observer } from 'mobx-react-lite';

import { useStore } from '../../contexts/StoreContext';
import FileDescription from '../../components/FileDescription';
import FileTags from '../../components/FileTag';
import ImageInfo from '../../components/ImageInfo';
import StarRating from '../../components/StarRating';
import { IconButton, IconSet } from 'widgets';
import { showItemInFolder } from 'src/frontend/services/shell';

const Inspector = observer(() => {
  const { uiStore, fileStore } = useStore();

  if (uiStore.firstItem >= fileStore.fileList.length || !uiStore.isInspectorOpen) {
    return (
      <aside id="inspector">
        <Placeholder />
      </aside>
    );
  }

  const first = fileStore.fileList[uiStore.firstItem];
  const path = first.absolutePath;

  return (
    <aside id="inspector">
      <section>
        <ImageInfo file={first} />
      </section>
      <section>
        <header>
          <h2>Rating</h2>
        </header>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0.25rem 0.5rem' }}>
          <StarRating
            key={`rating-${first.id}`}
            rating={first.rating}
            onChange={first.setRating}
            size="medium"
          />
        </div>
      </section>
      <section>
        <header>
          <h2>Path to file</h2>
        </header>
        <div className="input-file">
          <input readOnly className="input input-file-value" value={path} />
          <IconButton
            icon={IconSet.FOLDER_CLOSE}
            onClick={() => showItemInFolder(path)}
            text="Open in file explorer"
          />
        </div>
      </section>
      <section>
        <header>
          <h2>Description</h2>
        </header>
        <FileDescription key={first.id} file={first} />
      </section>
      <section>
        <header>
          <h2>Tags</h2>
        </header>
        <FileTags file={first} />
      </section>
    </aside>
  );
});

export default Inspector;

const Placeholder = () => {
  return (
    <section>
      <header>
        <h2>No image selected</h2>
      </header>
    </section>
  );
};
