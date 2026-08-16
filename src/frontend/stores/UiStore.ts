import { openExternal as openExternalFile } from 'src/frontend/services/shell';
import fse from 'fs-extra';
import { action, computed, makeObservable, observable } from 'mobx';

import { maxNumberOfExternalFilesBeforeWarning } from 'common/config';
import { clamp, notEmpty } from 'common/core';
import { ID } from '../../api/id';
import { SearchCriteria } from '../../api/search-criteria';
import { RendererMessenger } from '../../ipc/renderer';
import { ClientFile } from '../entities/File';
import {
  ClientFileSearchCriteria,
  ClientPaletteColorCriteria,
  ClientTagSearchCriteria,
} from '../entities/SearchCriteria';
import { ClientTag } from '../entities/Tag';
import { comboMatches, getKeyCombo, parseKeyCombo } from '../hotkeyParser';
import { registerThumbnailScope } from '../services/assetScope';
import RootStore from './RootStore';

export const enum ViewMethod {
  List,
  Grid,
  MasonryVertical,
  MasonryHorizontal,
}
export type ThumbnailSize = 'small' | 'medium' | 'large' | number;
type ThumbnailShape = 'square' | 'letterbox';
export type UpscaleMode = 'smooth' | 'pixelated';
export const PREFERENCES_STORAGE_KEY = 'preferences';

export interface IHotkeyMap {
  // Outliner actions
  toggleOutliner: string;
  replaceQuery: string;

  // Inspector actions
  toggleInspector: string;
  toggleSettings: string;
  toggleHelpCenter: string;

  // Toolbar actions (these should only be active when the content area is focused)
  deleteSelection: string;
  openTagEditor: string;
  selectAll: string;
  deselectAll: string;
  viewList: string;
  viewGrid: string;
  viewMasonryVertical: string;
  viewMasonryHorizontal: string;
  viewSlide: string;
  search: string;
  advancedSearch: string;

  // Other
  openPreviewWindow: string;
  openExternal: string;
  copyImage: string;
  renameFile: string;
}

// https://blueprintjs.com/docs/#core/components/hotkeys.dialog
export const defaultHotkeyMap: IHotkeyMap = {
  toggleOutliner: '1',
  toggleInspector: '2',
  replaceQuery: 'r',
  toggleSettings: 's',
  toggleHelpCenter: 'h',
  deleteSelection: 'del',
  openTagEditor: 't',
  selectAll: 'mod + a',
  deselectAll: 'mod + d',
  viewSlide: 'enter', // TODO: backspace and escape are hardcoded hotkeys to exist slide mode
  viewList: 'alt + 1',
  viewGrid: 'alt + 2',
  viewMasonryVertical: 'alt + 3',
  viewMasonryHorizontal: 'alt + 4',
  search: 'mod + f',
  advancedSearch: 'mod + shift + f',
  openPreviewWindow: 'space',
  openExternal: 'mod + enter',
  copyImage: 'mod + c',
  renameFile: 'f2',
};

/**
 * From: https://mobx.js.org/best/store.html
 * Things you will typically find in UI stores:
 * - Session information
 * - Information about how far your application has loaded
 * - Information that will not be stored in the backend
 * - Information that affects the UI globally:
 *  - Window dimensions
 *  - Accessibility information
 *  - Current language
 *  - Currently active theme
 * - User interface state as soon as it affects multiple, further unrelated components:
 *  - Current selection
 *  - Visibility of toolbars, etc.
 *  - State of a wizard
 *  - State of a global overlay
 */

/** These fields are stored and recovered when the application opens up */
type PersistentPreferenceFields =
  | 'theme'
  | 'isOutlinerOpen'
  | 'isInspectorOpen'
  | 'thumbnailDirectory'
  | 'importDirectory'
  | 'method'
  | 'thumbnailSize'
  | 'thumbnailShape'
  | 'upscaleMode'
  | 'hotkeyMap'
  | 'isThumbnailTagOverlayEnabled'
  | 'isThumbnailFilenameOverlayEnabled'
  | 'isThumbnailResolutionOverlayEnabled'
  | 'outlinerWidth'
  | 'inspectorWidth'
  | 'isRememberSearchEnabled'
  | 'gridGap'
  | 'gridBorderRadius'
  | 'gridBorderWidth'
  // the following are only restored when isRememberSearchEnabled is enabled
  | 'isSlideMode'
  | 'firstItem'
  | 'searchMatchAny'
  | 'searchCriteriaList';

class UiStore {
  static MIN_OUTLINER_WIDTH = 192; // default of 12 rem
  static MIN_INSPECTOR_WIDTH = 288; // default of 18 rem

  private readonly rootStore: RootStore;

  // Theme
  @observable theme: 'light' | 'dark' = 'dark';

  // UI
  @observable isOutlinerOpen: boolean = true;
  @observable isInspectorOpen: boolean = true;
  @observable isSettingsOpen: boolean = false;
  @observable isHelpCenterOpen: boolean = false;
  @observable isAboutOpen: boolean = false;
  @observable isLocationRecoveryOpen: ID | null = null;
  @observable isPreviewOpen: boolean = false;
  @observable isAdvancedSearchOpen: boolean = false;
  @observable searchMatchAny = false;
  @observable method: ViewMethod = ViewMethod.Grid;
  @observable isSlideMode: boolean = false;
  @observable isFullScreen: boolean = false;
  @observable outlinerWidth: number = UiStore.MIN_OUTLINER_WIDTH;
  @observable inspectorWidth: number = UiStore.MIN_INSPECTOR_WIDTH;
  /** Whether to show the tags on images in the content view */
  @observable isThumbnailTagOverlayEnabled: boolean = true;
  @observable isThumbnailFilenameOverlayEnabled: boolean = false;
  @observable isThumbnailResolutionOverlayEnabled: boolean = false;
  /** Whether to restore the last search query on start-up */
  @observable isRememberSearchEnabled: boolean = true;
  /** Index of the first item in the viewport. Also acts as the current item shown in slide mode */
  // TODO: Might be better to store the ID to the file. I believe we were storing the index for performance, but we have instant conversion between index/ID now
  @observable firstItem: number = 0;
  @observable thumbnailSize: ThumbnailSize | number = 'medium';
  @observable thumbnailShape: ThumbnailShape = 'square';
  @observable upscaleMode: UpscaleMode = 'smooth';
  @observable gridGap: number = 8;
  @observable gridBorderRadius: number = 4;
  @observable gridBorderWidth: number = 1;

  @observable isToolbarTagPopoverOpen: boolean = false;
  /** Dialog for removing unlinked files from Allusion's database */
  @observable isToolbarFileRemoverOpen: boolean = false;
  /** Dialog for moving files to the system's trash bin, and removing from Allusion's database */
  @observable isMoveFilesToTrashOpen: boolean = false;
  /** Dialog to warn the user when he tries to open too many files externally */
  @observable isManyExternalFilesOpen: boolean = false;

  // Selections
  // Observable arrays recommended like this here https://github.com/mobxjs/mobx/issues/669#issuecomment-269119270.
  // However, sets are more suitable because they have quicker lookup performance.
  readonly fileSelection = observable(new Set<ClientFile>());
  readonly tagSelection = observable(new Set<ClientTag>());

  readonly searchCriteriaList = observable<ClientFileSearchCriteria>([]);

  @observable thumbnailDirectory: string = '';
  @observable importDirectory: string = ''; // Must be a (sub-folder of a) Location

  @observable readonly hotkeyMap: IHotkeyMap = observable(defaultHotkeyMap);

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeObservable(this);
  }

  /////////////////// UI Actions ///////////////////
  @computed get isList(): boolean {
    return this.method === ViewMethod.List;
  }

  @computed get isGrid(): boolean {
    return this.method === ViewMethod.Grid;
  }

  @computed get isMasonryVertical(): boolean {
    return this.method === ViewMethod.MasonryVertical;
  }

  @computed get isMasonryHorizontal(): boolean {
    return this.method === ViewMethod.MasonryHorizontal;
  }

  @action.bound setThumbnailSize(size: ThumbnailSize): void {
    this.thumbnailSize = size;
  }

  @action.bound setThumbnailShape(shape: ThumbnailShape): void {
    this.thumbnailShape = shape;
  }

  @action.bound setUpscaleModeSmooth(): void {
    this.setUpscaleMode('smooth');
  }

  @action.bound setUpscaleModePixelated(): void {
    this.setUpscaleMode('pixelated');
  }

  @action.bound setUpscaleMode(mode: UpscaleMode): void {
    this.upscaleMode = mode;
  }

  @action.bound setGridGap(gap: number): void {
    this.gridGap = isFinite(gap) ? clamp(gap, 0, 32) : this.gridGap;
  }

  @action.bound setGridBorderRadius(radius: number): void {
    this.gridBorderRadius = isFinite(radius) ? clamp(radius, 0, 24) : this.gridBorderRadius;
  }

  @action.bound setGridBorderWidth(width: number): void {
    this.gridBorderWidth = isFinite(width) ? clamp(width, 0, 8) : this.gridBorderWidth;
  }

  @action.bound setFirstItem(index: number = 0): void {
    if (isFinite(index) && index < this.rootStore.fileStore.fileList.length) {
      this.firstItem = index;
    }
  }

  /** Clamps {@link UiStore.firstItem} into the bounds of the current file list, so it never points at a non-existent file. */
  @action.bound clampFirstItem(): void {
    const listLength = this.rootStore.fileStore.fileList.length;
    if (listLength === 0) {
      this.firstItem = 0;
    } else if (this.firstItem >= listLength) {
      this.firstItem = listLength - 1;
    } else if (this.firstItem < 0) {
      this.firstItem = 0;
    }
  }

  @action setMethod(method: ViewMethod): void {
    this.method = method;
  }

  @action.bound setMethodList(): void {
    this.method = ViewMethod.List;
  }

  @action.bound setMethodGrid(): void {
    this.method = ViewMethod.Grid;
  }

  @action.bound setMethodMasonryVertical(): void {
    this.method = ViewMethod.MasonryVertical;
  }

  @action.bound setMethodMasonryHorizontal(): void {
    this.method = ViewMethod.MasonryHorizontal;
  }

  @action.bound enableSlideMode(): void {
    this.isSlideMode = true;
  }

  @action.bound disableSlideMode(): void {
    this.isSlideMode = false;
  }

  @action.bound toggleSlideMode(): void {
    this.isSlideMode = !this.isSlideMode;
  }

  /** This does not actually set the window to full-screen, just for bookkeeping! Use RendererMessenger instead */
  @action.bound setFullScreen(val: boolean): void {
    this.isFullScreen = val;
  }

  @action.bound enableThumbnailTagOverlay(): void {
    this.isThumbnailTagOverlayEnabled = true;
  }

  @action.bound disableThumbnailTagOverlay(): void {
    this.isThumbnailTagOverlayEnabled = false;
  }

  @action.bound toggleThumbnailTagOverlay(): void {
    this.isThumbnailTagOverlayEnabled = !this.isThumbnailTagOverlayEnabled;
  }

  @action.bound toggleThumbnailFilenameOverlay(): void {
    this.isThumbnailFilenameOverlayEnabled = !this.isThumbnailFilenameOverlayEnabled;
  }

  @action.bound toggleThumbnailResolutionOverlay(): void {
    this.isThumbnailResolutionOverlayEnabled = !this.isThumbnailResolutionOverlayEnabled;
  }

  @action.bound toggleRememberSearchQuery(): void {
    this.isRememberSearchEnabled = !this.isRememberSearchEnabled;
  }

  @action.bound openOutliner(): void {
    this.setIsOutlinerOpen(true);
  }

  @action.bound toggleOutliner(): void {
    this.setIsOutlinerOpen(!this.isOutlinerOpen);
  }

  @action.bound openPreviewWindow(): void {
    // Don't open when no files have been selected
    if (this.fileSelection.size === 0) {
      return;
    }

    // If only one image was selected, open all images, but focus on the selected image. Otherwise, open selected images
    // TODO: FIXME: Disabled for now: makes it a lot less "snappy", takes a while for the message to come through
    // this.fileSelection.size === 1
    //   ? this.rootStore.fileStore.fileList
    //   : Array.from(this.fileSelection);

    RendererMessenger.sendPreviewFiles({
      ids: Array.from(this.fileSelection, (file) => file.id),
      activeImgId: this.getFirstSelectedFileId(),
      thumbnailDirectory: this.thumbnailDirectory,
      viewMethod: this.method,
    });

    this.isPreviewOpen = true;

    // remove focus from element so closing preview with spacebar does not trigger any ui elements
    if (document.activeElement && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  @action.bound openExternal(warnIfTooManyFiles: boolean = true): void {
    // Don't open when no files have been selected
    if (this.fileSelection.size === 0) {
      return;
    }

    if (warnIfTooManyFiles && this.fileSelection.size > maxNumberOfExternalFilesBeforeWarning) {
      this.isManyExternalFilesOpen = true;
      return;
    }

    const absolutePaths = Array.from(this.fileSelection, (file) => file.absolutePath);
    absolutePaths.forEach((path) => openExternalFile(`file://${path}`).catch(console.error));
  }

  @action.bound async copySelectedImage(): Promise<void> {
    const file = this.firstSelectedFile;
    if (!file || file.isBroken) {
      return;
    }
    await RendererMessenger.copyImageToClipboard(file.absolutePath);
  }

  @action.bound async copyImageFile(file: ClientFile): Promise<void> {
    if (!file || file.isBroken) {
      return;
    }
    await RendererMessenger.copyImageToClipboard(file.absolutePath);
  }

  @action.bound toggleInspector(): void {
    this.isInspectorOpen = !this.isInspectorOpen;
  }

  @action.bound openInspector(): void {
    this.isInspectorOpen = true;
  }

  @action.bound toggleSettings(): void {
    this.isSettingsOpen = !this.isSettingsOpen;
  }

  @action.bound closeSettings(): void {
    this.isSettingsOpen = false;
  }

  @action.bound toggleHelpCenter(): void {
    this.isHelpCenterOpen = !this.isHelpCenterOpen;
  }

  @action.bound closeHelpCenter(): void {
    this.isHelpCenterOpen = false;
  }

  @action.bound toggleAbout(): void {
    this.isAboutOpen = !this.isAboutOpen;
  }

  @action.bound closeAbout(): void {
    this.isAboutOpen = false;
  }

  @action.bound openToolbarFileRemover(): void {
    if (!this.rootStore.fileStore.showsMissingContent) {
      this.rootStore.fileStore.fetchMissingFiles();
    }
    this.isToolbarFileRemoverOpen = true;
  }

  @action.bound closeToolbarFileRemover(): void {
    this.isToolbarFileRemoverOpen = false;
  }

  @action.bound openMoveFilesToTrash(): void {
    this.isMoveFilesToTrashOpen = true;
  }

  @action.bound closeMoveFilesToTrash(): void {
    this.isMoveFilesToTrashOpen = false;
  }

  @action.bound closeManyExternalFiles(): void {
    this.isManyExternalFilesOpen = false;
  }

  @action.bound toggleToolbarTagPopover(): void {
    this.isToolbarTagPopoverOpen = !this.isToolbarTagPopoverOpen;
  }

  @action.bound openToolbarTagPopover(): void {
    if (this.fileSelection.size > 0) {
      this.isToolbarTagPopoverOpen = true;
    }
  }

  @action.bound closeToolbarTagPopover(): void {
    this.isToolbarTagPopoverOpen = false;
  }

  @action.bound openLocationRecovery(locationId: ID): void {
    this.isLocationRecoveryOpen = locationId;
  }

  @action.bound closeLocationRecovery(): void {
    this.isLocationRecoveryOpen = null;
  }

  @observable fileToRename: ClientFile | null = null;

  @action.bound openRenameFileDialog(file?: ClientFile): void {
    const target = file || (this.fileSelection.size > 0 ? Array.from(this.fileSelection)[0] : null);
    if (target) {
      this.fileToRename = target;
    }
  }

  @action.bound closeRenameFileDialog(): void {
    this.fileToRename = null;
  }

  @observable isDuplicatesModalOpen = false;

  @action.bound openDuplicatesModal(): void {
    this.isDuplicatesModalOpen = true;
  }

  @action.bound closeDuplicatesModal(): void {
    this.isDuplicatesModalOpen = false;
  }

  @action.bound closePreviewWindow(): void {
    this.isPreviewOpen = false;
  }

  @action.bound setThumbnailDirectory(dir: string = ''): void {
    this.thumbnailDirectory = dir;
    if (dir.length > 0) {
      // The Rust scope registration canonicalizes each path and silently skips
      // directories that don't exist yet. Thumbnails are generated *after* the
      // first scope registration, so on a fresh run the folder didn't exist yet
      // and the asset:// protocol never allowed it (403 Forbidden on every
      // thumbnail). Create it first so canonicalize succeeds.
      try {
        fse.ensureDirSync(dir);
      } catch (e) {
        console.warn('Could not create thumbnail directory', dir, e);
      }
    }
    // Thumbnails are loaded through the asset protocol in Tauri, so make sure
    // the directory is in the protocol scope (no-op outside of Tauri).
    registerThumbnailScope(dir);
  }

  @action.bound setImportDirectory(dir: string): void {
    this.importDirectory = dir;
  }

  @action.bound setTheme(theme: 'light' | 'dark' = 'dark'): void {
    this.theme = theme;
    RendererMessenger.setTheme({ theme });
  }

  @action.bound toggleAdvancedSearch(): void {
    this.isAdvancedSearchOpen = !this.isAdvancedSearchOpen;
  }

  @action.bound closeAdvancedSearch(): void {
    this.isAdvancedSearchOpen = false;
  }

  @action.bound toggleSearchMatchAny(): void {
    this.searchMatchAny = !this.searchMatchAny;
  }

  /////////////////// Selection actions ///////////////////
  @action.bound selectFile(file: ClientFile, clear?: boolean): void {
    if (clear === true) {
      this.clearFileSelection();
    }
    this.fileSelection.add(file);
    this.setFirstItem(this.rootStore.fileStore.getIndex(file.id));
  }

  @action.bound deselectFile(file: ClientFile): void {
    this.fileSelection.delete(file);
  }

  @action.bound toggleFileSelection(file: ClientFile, clear?: boolean): void {
    if (this.fileSelection.has(file)) {
      this.fileSelection.delete(file);
    } else {
      if (clear) {
        this.fileSelection.clear();
      }
      this.fileSelection.add(file);
    }
  }

  @action.bound selectFileRange(start: number, end: number, additive?: boolean): void {
    if (!additive) {
      this.fileSelection.clear();
    }
    for (let i = start; i <= end; i++) {
      this.fileSelection.add(this.rootStore.fileStore.fileList[i]);
    }
  }

  @action.bound selectAllFiles(): void {
    this.fileSelection.replace(this.rootStore.fileStore.fileList);
  }

  @action.bound clearFileSelection(): void {
    this.fileSelection.clear();
  }

  @action.bound selectTag(tag: ClientTag, clear?: boolean): void {
    if (clear === true) {
      this.clearTagSelection();
    }
    this.tagSelection.add(tag);
  }

  @action.bound deselectTag(tag: ClientTag): void {
    this.tagSelection.delete(tag);
  }

  @action.bound toggleTagSelection(tag: ClientTag): void {
    if (this.tagSelection.has(tag)) {
      this.tagSelection.delete(tag);
    } else {
      this.tagSelection.add(tag);
    }
  }

  /** Selects a range of tags, where indices correspond to the flattened tag list. */
  @action.bound selectTagRange(start: number, end: number, additive?: boolean): void {
    const tagTreeList = this.rootStore.tagStore.tagList;
    if (!additive) {
      this.tagSelection.replace(tagTreeList.slice(start, end + 1));
      return;
    }
    for (let i = start; i <= end; i++) {
      this.tagSelection.add(tagTreeList[i]);
    }
  }

  @action.bound selectAllTags(): void {
    this.tagSelection.replace(this.rootStore.tagStore.tagList);
  }

  @action.bound clearTagSelection(): void {
    this.tagSelection.clear();
  }

  @action.bound async removeSelectedTags(): Promise<void> {
    const ctx = this.getTagContextItems();
    return this.rootStore.tagStore.deleteTags(ctx);
  }

  @action.bound colorSelectedTagsAndCollections(activeElementId: ID, color: string): void {
    const ctx = this.getTagContextItems(activeElementId);
    const colorCollection = (tag: ClientTag) => {
      tag.setColor(color);
      tag.subTags.forEach((tag) => tag.setColor(color));
    };
    ctx.forEach(colorCollection);
  }

  /**
   * Returns the tags and tag collections that are in the context of an action,
   * e.g. all selected items when choosing to delete an item that is selected,
   * or only a single item when moving a single tag that is not selected.
   * @returns The collections and tags in the context. Tags belonging to collections in the context are not included,
   * but can be easily found by getting the tags from each collection.
   */
  @action.bound getTagContextItems(activeItemId?: ID): ClientTag[] {
    const { tagStore } = this.rootStore;

    // If no id was given, the context is the tag selection. Else, it might be a single tag/collection
    let isContextTheSelection = activeItemId === undefined;

    const contextTags: ClientTag[] = [];

    // If an id is given, check whether it belongs to a tag or collection
    if (activeItemId) {
      const selectedTag = tagStore.get(activeItemId);
      if (selectedTag) {
        if (selectedTag.isSelected) {
          isContextTheSelection = true;
        } else {
          contextTags.push(selectedTag);
        }
      }
    }

    // If no id is given or when the selected tag or collection is selected, the context is the whole selection
    if (isContextTheSelection) {
      contextTags.push(...this.tagSelection);
    }

    return contextTags;
  }

  /**
   * @param targetId Where to move the selection to
   */
  @action.bound moveSelectedTagItems(id: ID, pos = 0): void {
    const { tagStore } = this.rootStore;

    const target = tagStore.get(id);
    if (!target) {
      throw new Error('Invalid target to move to');
    }

    // Find all tags + collections in the current context (all selected items)
    const ctx = this.getTagContextItems();

    // Move tags and collections
    ctx.forEach((tag) => target.insertSubTag(tag, pos));
  }

  /////////////////// Search Actions ///////////////////
  @action.bound clearSearchCriteriaList(): void {
    if (this.searchCriteriaList.length > 0) {
      this.searchCriteriaList.forEach((c) => c.dispose());
      this.searchCriteriaList.clear();
      this.viewAllContent();
    }
  }

  @action.bound addSearchCriteria(query: Exclude<ClientFileSearchCriteria, 'key'>): void {
    this.searchCriteriaList.push(query);
    this.viewQueryContent();
  }

  @action.bound addSearchCriterias(queries: Exclude<ClientFileSearchCriteria[], 'key'>): void {
    this.searchCriteriaList.push(...queries);
    this.viewQueryContent();
  }

  @action.bound toggleSearchCriterias(queries: Exclude<ClientFileSearchCriteria[], 'key'>): void {
    // TODO: can be improved
    const deepEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

    // With control, add or remove the criteria based on whether they're already being searched with
    const existingMatchingCriterias = queries.map((crit) =>
      this.searchCriteriaList.find((other) =>
        deepEqual(other.serialize(this.rootStore), crit.serialize(this.rootStore)),
      ),
    );
    if (existingMatchingCriterias.every(notEmpty)) {
      // If they're already in there, remove them
      existingMatchingCriterias.forEach((query) => {
        this.searchCriteriaList.remove(query);
        query.dispose();
      });
      if (this.searchCriteriaList.length > 0) {
        this.viewQueryContent();
      } else {
        this.viewAllContent();
      }
    } else {
      // If they're not already in there, add them
      this.addSearchCriterias(queries);
    }
  }

  @action.bound removeSearchCriteria(query: ClientFileSearchCriteria): void {
    query.dispose();
    this.searchCriteriaList.remove(query);
    if (this.searchCriteriaList.length > 0) {
      this.viewQueryContent();
    } else {
      this.viewAllContent();
    }
  }

  @action.bound replaceSearchCriteria(query: Exclude<ClientFileSearchCriteria, 'key'>): void {
    this.replaceSearchCriterias([query]);
  }

  /**
   * Replaces only the palette color criteria with a single color, keeping all
   * other search criteria (e.g. tags) intact. Used by the toolbar's single-color mode.
   */
  @action.bound replacePaletteColorCriteria(
    query: Exclude<ClientPaletteColorCriteria, 'key'>,
  ): void {
    // Remove the existing palette color criteria, but keep the other criteria
    const kept = this.searchCriteriaList.filter(
      (crit) => !(crit instanceof ClientPaletteColorCriteria),
    );
    this.searchCriteriaList.forEach((crit) => {
      if (crit instanceof ClientPaletteColorCriteria) {
        crit.dispose();
      }
    });
    this.searchCriteriaList.replace([...kept, query]);
    this.viewQueryContent();
  }

  @action.bound replaceSearchCriterias(queries: Exclude<ClientFileSearchCriteria[], 'key'>): void {
    this.searchCriteriaList.forEach((c) => c.dispose());

    this.searchCriteriaList.replace(queries);

    if (this.searchCriteriaList.length > 0) {
      this.viewQueryContent();
    } else {
      this.viewAllContent();
    }
  }

  @action.bound removeSearchCriteriaByIndex(i: number): void {
    const removedCrits = this.searchCriteriaList.splice(i, 1);

    removedCrits.forEach((c) => c.dispose());

    if (this.searchCriteriaList.length > 0) {
      this.viewQueryContent();
    } else {
      this.viewAllContent();
    }
  }

  @action.bound addTagSelectionToCriteria(): void {
    const newCrits = Array.from(
      this.tagSelection,
      (tag) => new ClientTagSearchCriteria('tags', tag.id),
    );
    this.addSearchCriterias(newCrits);
    this.clearTagSelection();
  }

  @action.bound replaceCriteriaWithTagSelection(): void {
    this.replaceSearchCriterias(
      Array.from(this.tagSelection, (tag) => new ClientTagSearchCriteria('tags', tag.id)),
    );
    this.clearTagSelection();
  }

  @action.bound replaceCriteriaItem(
    oldCrit: ClientFileSearchCriteria,
    crit: ClientFileSearchCriteria,
  ): void {
    const index = this.searchCriteriaList.indexOf(oldCrit);
    if (index !== -1) {
      this.searchCriteriaList[index].dispose();
      this.searchCriteriaList[index] = crit;
      this.viewQueryContent();
    }
  }

  @action.bound remapHotkey(action: keyof IHotkeyMap, combo: string): void {
    this.hotkeyMap[action] = combo;
  }

  @action.bound processGlobalShortCuts(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.matches('input')) {
      return;
    }
    const combo = getKeyCombo(e);
    const matches = (c: string): boolean => {
      return comboMatches(combo, parseKeyCombo(c));
    };
    const { hotkeyMap } = this;
    let isMatch = true;
    // UI
    if (matches(hotkeyMap.toggleOutliner)) {
      this.toggleOutliner();
    } else if (matches(hotkeyMap.toggleInspector)) {
      this.toggleInspector();
    } else if (matches(hotkeyMap.openTagEditor)) {
      // Windows
    } else if (matches(hotkeyMap.toggleSettings)) {
      this.toggleSettings();
    } else if (matches(hotkeyMap.toggleHelpCenter)) {
      this.toggleHelpCenter();
    } else if (matches(hotkeyMap.openPreviewWindow)) {
      this.openPreviewWindow();
      e.preventDefault(); // prevent scrolling with space when opening the preview window
    } else if (matches(hotkeyMap.openExternal)) {
      this.openExternal();
    } else if (matches(hotkeyMap.copyImage)) {
      this.copySelectedImage();
    } else if (matches(hotkeyMap.renameFile)) {
      this.openRenameFileDialog();
      // Search
    } else if (matches(hotkeyMap.search)) {
      (document.querySelector('.searchbar input') as HTMLElement).focus();
    } else if (matches(hotkeyMap.advancedSearch)) {
      this.toggleAdvancedSearch();
      // View
    } else if (matches(hotkeyMap.viewList)) {
      this.setMethodList();
    } else if (matches(hotkeyMap.viewGrid)) {
      this.setMethodGrid();
    } else if (matches(hotkeyMap.viewMasonryVertical)) {
      this.setMethodMasonryVertical();
    } else if (matches(hotkeyMap.viewMasonryHorizontal)) {
      this.setMethodMasonryHorizontal();
    } else if (matches(hotkeyMap.viewSlide)) {
      this.toggleSlideMode();
    } else {
      isMatch = false;
    }

    if (isMatch) {
      e.preventDefault();
    }
  }

  @action.bound moveOutlinerSplitter(x: number, width: number): void {
    if (this.isOutlinerOpen) {
      const w = clamp(x, UiStore.MIN_OUTLINER_WIDTH, width * 0.75);
      this.outlinerWidth = w;

      // Automatically collapse if less than 3/4 of min-width?
      if (x < UiStore.MIN_OUTLINER_WIDTH * 0.75) {
        this.isOutlinerOpen = false;
      }
    } else if (x >= UiStore.MIN_OUTLINER_WIDTH) {
      this.isOutlinerOpen = true;
    }
  }

  @action.bound moveInspectorSplitter(x: number, width: number): void {
    // The inspector is on the right side, so we need to calculate the offset.
    const offsetX = width - x;
    if (this.isInspectorOpen) {
      const w = clamp(offsetX, UiStore.MIN_INSPECTOR_WIDTH, width * 0.75);
      this.inspectorWidth = w;

      if (offsetX < UiStore.MIN_INSPECTOR_WIDTH * 0.75) {
        this.isInspectorOpen = false;
      }
    } else if (offsetX >= UiStore.MIN_INSPECTOR_WIDTH) {
      this.isInspectorOpen = true;
    }
  }

  // Storing preferences
  @action recoverPersistentPreferences(): void {
    const prefsString = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (prefsString) {
      try {
        const prefs = JSON.parse(prefsString);
        if (prefs.theme) {
          this.setTheme(prefs.theme);
        }
        this.setIsOutlinerOpen(prefs.isOutlinerOpen);
        this.isInspectorOpen = Boolean(prefs.isInspectorOpen);
        // Only restore a thumbnail directory that is an absolute path. During
        // the early Tauri migration `get_path('temp')` failed and the fallback
        // `/tmp/allusion/Allusion/thumbnails` got persisted; restoring that
        // broken relative value makes every thumbnail asset:// URL point at a
        // path outside the protocol scope (403 Forbidden on the whole grid).
        if (prefs.thumbnailDirectory && isAbsolutePath(prefs.thumbnailDirectory)) {
          this.setThumbnailDirectory(prefs.thumbnailDirectory);
        }
        if (prefs.importDirectory) {
          this.setImportDirectory(prefs.importDirectory);
        }
        this.setMethod(Number(prefs.method));
        if (prefs.thumbnailSize) {
          this.setThumbnailSize(prefs.thumbnailSize);
        }
        if (prefs.thumbnailShape) {
          this.setThumbnailShape(prefs.thumbnailShape);
        }
        if (prefs.upscaleMode) {
          this.setUpscaleMode(prefs.upscaleMode);
        }
        if (prefs.gridGap !== undefined) {
          this.setGridGap(Number(prefs.gridGap));
        }
        if (prefs.gridBorderRadius !== undefined) {
          this.setGridBorderRadius(Number(prefs.gridBorderRadius));
        }
        if (prefs.gridBorderWidth !== undefined) {
          this.setGridBorderWidth(Number(prefs.gridBorderWidth));
        }
        this.isThumbnailTagOverlayEnabled = Boolean(prefs.isThumbnailTagOverlayEnabled ?? true);
        this.isThumbnailFilenameOverlayEnabled = Boolean(prefs.isThumbnailFilenameOverlayEnabled ?? false); // eslint-disable-line prettier/prettier
        this.isThumbnailResolutionOverlayEnabled = Boolean(prefs.isThumbnailResolutionOverlayEnabled ?? false); // eslint-disable-line prettier/prettier
        this.outlinerWidth = Math.max(Number(prefs.outlinerWidth), UiStore.MIN_OUTLINER_WIDTH);
        this.inspectorWidth = Math.max(Number(prefs.inspectorWidth), UiStore.MIN_INSPECTOR_WIDTH);
        Object.entries<string>(prefs.hotkeyMap).forEach(
          ([k, v]) => k in defaultHotkeyMap && (this.hotkeyMap[k as keyof IHotkeyMap] = v),
        );

        this.isRememberSearchEnabled = Boolean(prefs.isRememberSearchEnabled);
        if (this.isRememberSearchEnabled) {
          // If remember search criteria, restore the search criteria list...
          const serializedCriteriaList: SearchCriteria[] =
            // BACKWARDS_COMPATIBILITY: searchCriteriaList used to be serialized to a string
            typeof prefs.searchCriteriaList === 'string'
              ? JSON.parse(prefs.searchCriteriaList ?? '[]')
              : prefs.searchCriteriaList ?? [];
          const newCrits = serializedCriteriaList.map((c) =>
            ClientFileSearchCriteria.deserialize(c),
          );
          this.searchCriteriaList.push(...newCrits);

          // and other content-related options. So it's just like you never closed Allusion!
          this.firstItem = prefs.firstItem;
          this.searchMatchAny = prefs.searchMatchAny;
          this.isSlideMode = prefs.isSlideMode;
        }
        console.info('recovered', prefs);
      } catch (e) {
        console.error('Cannot parse persistent preferences', e);
      }
      // Set the native window theme based on the application theme
      RendererMessenger.setTheme({ theme: this.theme === 'dark' ? 'dark' : 'light' });
    }

    // Set default thumbnail directory in case none was specified
    if (this.thumbnailDirectory.length === 0) {
      RendererMessenger.getDefaultThumbnailDirectory().then((defaultThumbDir) => {
        this.setThumbnailDirectory(defaultThumbDir);
        console.info('[tauri-diag] default thumbnailDirectory =', defaultThumbDir);
        fse.ensureDirSync(this.thumbnailDirectory);
      });
    }
  }

  getPersistentPreferences(): Partial<Record<keyof UiStore, unknown>> {
    const preferences: Record<PersistentPreferenceFields, unknown> = {
      theme: this.theme,
      isOutlinerOpen: this.isOutlinerOpen,
      isInspectorOpen: this.isInspectorOpen,
      thumbnailDirectory: this.thumbnailDirectory,
      importDirectory: this.importDirectory,
      method: this.method,
      thumbnailSize: this.thumbnailSize,
      thumbnailShape: this.thumbnailShape,
      upscaleMode: this.upscaleMode,
      hotkeyMap: { ...this.hotkeyMap },
      isThumbnailFilenameOverlayEnabled: this.isThumbnailFilenameOverlayEnabled,
      isThumbnailTagOverlayEnabled: this.isThumbnailTagOverlayEnabled,
      isThumbnailResolutionOverlayEnabled: this.isThumbnailResolutionOverlayEnabled,
      outlinerWidth: this.outlinerWidth,
      inspectorWidth: this.inspectorWidth,
      isRememberSearchEnabled: this.isRememberSearchEnabled,
      gridGap: this.gridGap,
      gridBorderRadius: this.gridBorderRadius,
      gridBorderWidth: this.gridBorderWidth,
      isSlideMode: this.isSlideMode,
      firstItem: this.firstItem,
      searchMatchAny: this.searchMatchAny,
      searchCriteriaList: this.searchCriteriaList.map((c) => c.serialize(this.rootStore)),
    };
    return preferences;
  }

  clearPersistentPreferences(): void {
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  }

  /////////////////// Helper methods ///////////////////
  @action.bound clearSelection(): void {
    this.tagSelection.clear();
    this.fileSelection.clear();
  }

  getFirstSelectedFileId(): ID | undefined {
    return this.firstSelectedFile?.id;
  }

  @computed get firstSelectedFile(): ClientFile | undefined {
    for (const file of this.fileSelection) {
      return file;
    }
    return undefined;
  }

  /** Return {@link UiStore.firstItem}: first item visible in viewport, and the current item in SlideMode */
  @computed get firstFileInView(): ClientFile | undefined {
    return this.firstItem < this.rootStore.fileStore.fileList.length
      ? this.rootStore.fileStore.fileList[this.firstItem]
      : undefined;
  }

  @action private viewAllContent(): void {
    this.rootStore.fileStore.fetchAllFiles();
  }

  @action private viewQueryContent(): void {
    this.rootStore.fileStore.fetchFilesByQuery();
  }

  @action private setIsOutlinerOpen(value: boolean = true) {
    this.isOutlinerOpen = value;
  }
}

export default UiStore;

// A thumbnail directory is only usable when it's a real absolute path. Reject
// relative paths and the `/tmp/...` fallback that `getPath` returns when the
// Tauri `get_path` command fails (that value used to be persisted and broke
// every thumbnail URL with 403 Forbidden).
const isAbsolutePath = (p: string): boolean =>
  !p.startsWith('/tmp/') && (/^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]/.test(p));
