import { observer } from 'mobx-react-lite';
import React, { ReactNode, useCallback, useState } from 'react';
import { IMG_EXTENSIONS, IMG_EXTENSIONS_TYPE } from 'src/api/file';
import { RendererMessenger } from 'src/ipc/renderer';
import { Button, ButtonGroup, Checkbox, IconSet, Toggle } from 'widgets';
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
        <legend>Supported file formats to be discovered in your Locations</legend>
        <div className="checkbox-set-container">
          {IMG_EXTENSIONS.map((ext) => (
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

      <div className="vstack">
        <Toggle
          checked={uiStore.isVideoHoverPreviewEnabled}
          onChange={uiStore.toggleVideoHoverPreview}
        >
          Preview videos on mouse hover
        </Toggle>

        <Toggle checked={removeDisabledImages} onChange={toggleRemoveDisabledImages}>
          Remove files with disabled extensions after save
        </Toggle>
      </div>

      <ButtonGroup>
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
      </ButtonGroup>
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
