import { observer } from 'mobx-react-lite';
import React, { ReactNode, useCallback, useState } from 'react';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, IMG_EXTENSIONS, IMG_EXTENSIONS_TYPE } from 'src/api/file';
import { RendererMessenger } from 'src/ipc/renderer';
import { Button, Checkbox, IconSet, Toggle } from 'widgets';
import { useStore } from '../../contexts/StoreContext';

export const ImageFormatPicker = observer(() => {
  const { locationStore, fileStore, uiStore } = useStore();

  const [removeDisabledImages, setRemoveDisabledImages] = useState(true);
  const toggleRemoveDisabledImages = useCallback(() => setRemoveDisabledImages((val) => !val), []);

  const [newEnabledFileExtensions, setNewEnabledFileExtensions] = useState(
    new Set(locationStore.enabledFileExtensions),
  );
  const toggleExtension = useCallback(
    (ext: IMG_EXTENSIONS_TYPE) => {
      const newNewEnabledFileExtensions = new Set(newEnabledFileExtensions);
      if (newEnabledFileExtensions.has(ext)) {
        newNewEnabledFileExtensions.delete(ext);
      } else {
        newNewEnabledFileExtensions.add(ext);
      }
      setNewEnabledFileExtensions(newNewEnabledFileExtensions);
    },
    [newEnabledFileExtensions],
  );

  const toggleAllVideos = useCallback(() => {
    const newSet = new Set(newEnabledFileExtensions);
    const allVideosEnabled = VIDEO_EXTENSIONS.every((ext) => newSet.has(ext));
    if (allVideosEnabled) {
      VIDEO_EXTENSIONS.forEach((ext) => newSet.delete(ext));
    } else {
      VIDEO_EXTENSIONS.forEach((ext) => newSet.add(ext));
    }
    setNewEnabledFileExtensions(newSet);
  }, [newEnabledFileExtensions]);

  const areAllVideosEnabled = VIDEO_EXTENSIONS.every((ext) => newEnabledFileExtensions.has(ext));

  const onSubmit = useCallback(async () => {
    if (removeDisabledImages) {
      const extensionsToDelete = IMG_EXTENSIONS.filter((ext) => !newEnabledFileExtensions.has(ext));

      for (const ext of extensionsToDelete) {
        await fileStore.deleteFilesByExtension(ext);
      }
    }

    locationStore.setSupportedImageExtensions(newEnabledFileExtensions);

    window.alert('Allusion will restart to load your new preferences.');

    RendererMessenger.reload();
  }, [fileStore, locationStore, newEnabledFileExtensions, removeDisabledImages]);

  return (
    <>
      <fieldset>
        <legend>Image formats</legend>
        <div className="checkbox-set-container">
          {IMAGE_EXTENSIONS.map((ext) => (
            <Checkbox
              key={ext}
              checked={newEnabledFileExtensions.has(ext)}
              onChange={() => toggleExtension(ext)}
            >
              {ext}
              {imageFormatInts[ext] && <> {imageFormatInts[ext]}</>}
            </Checkbox>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Video formats</span>
          <button
            type="button"
            className="btn btn-small"
            style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', cursor: 'pointer' }}
            onClick={toggleAllVideos}
          >
            {areAllVideosEnabled ? 'Disable all videos' : 'Enable all videos'}
          </button>
        </legend>
        <div className="checkbox-set-container">
          {VIDEO_EXTENSIONS.map((ext) => (
            <Checkbox
              key={ext}
              checked={newEnabledFileExtensions.has(ext)}
              onChange={() => toggleExtension(ext)}
            >
              {ext}
              {imageFormatInts[ext] && <> {imageFormatInts[ext]}</>}
            </Checkbox>
          ))}
        </div>
      </fieldset>

      <Toggle checked={uiStore.isVideoHoverPreviewEnabled} onChange={uiStore.toggleVideoHoverPreview}>
        Preview videos on mouse hover in the gallery grid
      </Toggle>

      <Toggle checked={removeDisabledImages} onChange={toggleRemoveDisabledImages}>
        Remove images/videos with disabled file extensions after save
      </Toggle>

      <Button
        text="Reset"
        onClick={() => setNewEnabledFileExtensions(new Set(locationStore.enabledFileExtensions))}
      />
      <Button
        text="Save"
        styling="filled"
        onClick={onSubmit}
        disabled={
          newEnabledFileExtensions.size === 0 ||
          // Disabled if identical
          (newEnabledFileExtensions.size === locationStore.enabledFileExtensions.size &&
            Array.from(newEnabledFileExtensions.values()).every((ext) =>
              locationStore.enabledFileExtensions.has(ext),
            ))
        }
      />
    </>
  );
});

const imageFormatInts: Partial<Record<IMG_EXTENSIONS_TYPE, ReactNode>> = {
  exr: (
    <span
      // TODO: Get TooltipLayer working in PopupWindow: tried a bunch of things but no bueno
      title="Experimental: May slow down the application when enabled (disabled by default)"
      className="info-icon"
    >
      {IconSet.WARNING}
    </span>
  ),
};
