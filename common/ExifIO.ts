// This file is our connector for reading EXIF metadata via the native Tauri Rust
// command (`read_exif_metadata`), backed by kamadak-exif (#19).
//
// Writing tags/metadata to files (via the node-exiftool sidecar) was removed in
// #32: tags live in the database ("Pinterest local" model), not embedded in the
// files.

/**
 * Braindump (historical, kept for context):
 * - When adding a new location, EXIF is used for image resolution/dimensions.
 * - ExifTool can read all files in a directory recursively.
 */

import { NativeExifData, nativeToDimensions, nativeToExifTags } from './exif-native';

class ExifIO {
  async initialize(): Promise<ExifIO> {
    // The native Rust parser needs no setup.
    return this;
  }

  async close(): Promise<void> {
    // No sidecar process to close.
  }

  // ------------------

  /** Reads native EXIF metadata via the Tauri Rust command. */
  private async readNativeExif(filepath: string): Promise<NativeExifData | null> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { invoke } = require('@tauri-apps/api/core');
    try {
      const data = (await invoke('read_exif_metadata', { path: filepath })) as NativeExifData;
      return data;
    } catch (e) {
      console.error('Could not read EXIF metadata from ', filepath, e);
      return null;
    }
  }

  async readExifTags(filepath: string, tags: string[]): Promise<(string | undefined)[]> {
    const data = await this.readNativeExif(filepath);
    return nativeToExifTags(data, tags);
  }

  /**
   * Extracts the width and height resolution of an image file from its exif data.
   * @param filepath The file to read the resolution from
   * @returns The width and height of the image, or width and height as 0 if the resolution could not be determined.
   */
  async getDimensions(filepath: string): Promise<{ width: number; height: number }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { invoke } = require('@tauri-apps/api/core');
      const dims = (await invoke('get_image_dimensions', {
        path: filepath,
      })) as [number, number];
      const [width, height] = dims;
      return { width, height };
    } catch (e) {
      // Fall back to EXIF dimensions (JPEG/TIFF) if header parsing fails.
      try {
        const data = await this.readNativeExif(filepath);
        return nativeToDimensions(data);
      } catch (e2) {
        console.error('Could not read image dimensions from ', filepath, e);
        return { width: 0, height: 0 };
      }
    }
  }

  /**
   * Extracts the embedded thumbnail of a file into its own separate image file
   * @param input
   * @param output
   * @returns Whether the thumbnail could be extracted successfully
   */
  async extractThumbnail(_input: string, _output: string): Promise<boolean> {
    // Embedded thumbnail extraction required the exiftool sidecar (removed in #32).
    // Not available on the native path yet.
    return false;
  }
}

export default ExifIO;
