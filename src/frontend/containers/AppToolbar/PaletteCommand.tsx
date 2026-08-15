import { observer } from 'mobx-react-lite';
import React from 'react';

import { FIXED_COLORS, FIXED_COLORS_BY_ID, getNearestColorId } from 'common/color';
import { IconSet } from 'widgets';
import { MenuButton, MenuRadioGroup, MenuRadioItem } from 'widgets/menus';
import { useStore } from '../../contexts/StoreContext';
import { ClientPaletteColorCriteria } from '../../entities/SearchCriteria';
import { useAction, useComputed } from '../../hooks/mobx';

const PaletteCommand = observer(() => {
  const color = useHeaderColor();

  const icon = (
    <span className="palette-button-icon">
      {IconSet.COLOR}
      {color.get() && (
        <span className="palette-button-dot" style={{ backgroundColor: color.get() }} aria-hidden />
      )}
    </span>
  );

  return (
    <MenuButton
      icon={icon}
      text="Filter by color"
      tooltip="Filter images by dominant color"
      id="__palette-menu"
      menuID="__palette-options"
    >
      <PaletteMenuItems />
    </MenuButton>
  );
});

/**
 * The color of the small indicator dot next to the toolbar button's icon.
 * Reflects (in order of priority): an active color criteria in the search
 * query, else the dominant color of the currently selected images (nearest
 * fixed color, plurality vote), else undefined (no dot).
 */
const useHeaderColor = () => {
  const { uiStore } = useStore();

  return useComputed(() => {
    for (const crit of uiStore.searchCriteriaList) {
      if (crit instanceof ClientPaletteColorCriteria && crit.value) {
        return FIXED_COLORS_BY_ID[crit.value].hex;
      }
    }

    const votes = new Map<string, number>();
    for (const file of uiStore.fileSelection) {
      if (file.palette.length > 0) {
        const dominant = file.palette[0];
        const id = getNearestColorId(dominant.r, dominant.g, dominant.b);
        votes.set(id, (votes.get(id) ?? 0) + 1);
      }
    }
    if (votes.size === 0) {
      return undefined;
    }

    let bestId = '';
    let bestCount = -1;
    votes.forEach((count, id) => {
      if (count > bestCount) {
        bestCount = count;
        bestId = id;
      }
    });
    return FIXED_COLORS_BY_ID[bestId].hex;
  });
};

export default PaletteCommand;

const PaletteMenuItems = observer(() => {
  const { uiStore } = useStore();

  const activeColors = useComputed(() => {
    const colors = new Set<string>();
    uiStore.searchCriteriaList.forEach((crit) => {
      if (crit instanceof ClientPaletteColorCriteria && crit.value) {
        colors.add(crit.value);
      }
    });
    return colors;
  });

  const handleToggle = useAction((e: React.MouseEvent<HTMLElement>, colorId: string) => {
    const criteria = new ClientPaletteColorCriteria('palette', colorId, 'contains');
    if (e.ctrlKey) {
      // Ctrl+click: add/remove this color to the selection, keeping other colors
      uiStore.toggleSearchCriterias([criteria]);
    } else {
      // Plain click: replace the color selection with this single color
      uiStore.replacePaletteColorCriteria(criteria);
    }
  });

  return (
    <MenuRadioGroup>
      {FIXED_COLORS.map((color) => (
        <MenuRadioItem
          key={color.id}
          icon={<span className="palette-swatch" style={{ background: color.hex }} aria-hidden />}
          text={color.name}
          checked={activeColors.get().has(color.id)}
          onClick={(e) => handleToggle(e, color.id)}
        />
      ))}
    </MenuRadioGroup>
  );
});
