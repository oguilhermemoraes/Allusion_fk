import { ID } from './id';

export type FileDTO = {
  id: ID;
  /** Identifier for a file that persists after renaming/moving (retrieved from fs.Stats.ino) */
  ino: string;
  locationId: ID;
  /** Path relative to Location */
  relativePath: string;
  absolutePath: string;
  tags: ID[];
  /** When the file was imported into Allusion */
  dateAdded: Date;
  /** When the file was modified in Allusion, not related to OS modified date */
  dateModified: Date;
  /**
   * When the file was last indexed in Allusion: concerning the metadata and thumbnail.
   * If the system's modified date of the file exceeds this date, those properties shoudld be re-initialized
   **/
  dateLastIndexed: Date;

  /** Duplicate data; also exists as part of the absolutePath. Used for DB queries */
  name: string;
  /** in lowercase, without the dot */
  extension: IMG_EXTENSIONS_TYPE;
  /** Size in bytes */
  size: number;
  width: number;
  height: number;
  /** Date when this file was created (from the OS, not related to Allusion) */
  dateCreated: Date;

  /**
   * Optional free-form description (e.g. the AI prompt used to generate this image).
   * Stored only in the database, never written to the file itself (#49).
   */
  description?: string;
  /**
   * Optional rating from 1 to 5 stars (0 or undefined indicates unrated) (#53).
   */
  rating?: number;
  /**
   * Optional duration in seconds for video and audio files (#54).
   */
  duration?: number;
  /** Dominant colors extracted during indexing (see #66), oldest first by coverage. */
  palette?: PaletteColorDTO[];
};

/** A dominant color of an image (0-255 RGB + coverage 0-1). Mirrors the Rust `PaletteColor`. */
export type PaletteColorDTO = {
  r: number;
  g: number;
  b: number;
  percentage: number;
};

export const IMAGE_EXTENSIONS = [
  'gif',
  'png',
  'apng',
  'jpg',
  'jpeg',
  'jfif',
  'webp',
  'tif',
  'tiff',
  'bmp',
  'ico',
  'svg',
  'psd',
  'kra',
  'exr',
] as const;
export type IMAGE_EXTENSIONS_TYPE = (typeof IMAGE_EXTENSIONS)[number];

export const VIDEO_EXTENSIONS = [
  'mp4',
  'webm',
  'mov',
  'mkv',
  'ogg',
  'avi',
] as const;
export type VIDEO_EXTENSIONS_TYPE = (typeof VIDEO_EXTENSIONS)[number];

export const IMG_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
] as const;
export type IMG_EXTENSIONS_TYPE = (typeof IMG_EXTENSIONS)[number];

export function isVideoExtension(ext?: string): boolean {
  if (!ext) return false;
  const cleanExt = ext.toLowerCase().replace(/^\./, '');
  return (VIDEO_EXTENSIONS as readonly string[]).includes(cleanExt);
}

export function isImageExtension(ext?: string): boolean {
  if (!ext) return false;
  const cleanExt = ext.toLowerCase().replace(/^\./, '');
  return (IMAGE_EXTENSIONS as readonly string[]).includes(cleanExt);
}

