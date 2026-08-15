import { invoke } from '@tauri-apps/api/core';
import { PathDecoder } from './util';

interface NativeExrImage {
  width: number;
  height: number;
  rgba_bytes: number[];
}

class ExrLoader implements PathDecoder {
  decodePath(path: string): Promise<ImageData> {
    return invoke<NativeExrImage>('decode_exr_image', { path }).then(
      (image) => new ImageData(new Uint8ClampedArray(image.rgba_bytes), image.width, image.height),
    );
  }
}

export default ExrLoader;
