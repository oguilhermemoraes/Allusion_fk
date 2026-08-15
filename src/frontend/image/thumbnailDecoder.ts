import { thumbnailFormat, thumbnailMaxSize } from 'common/config';

// Pure browser APIs: safe to run inside a Web Worker.

export const decodeThumbnailData = async (inputBuffer: Uint8Array): Promise<ArrayBuffer | null> => {
  const inputBlob = new Blob([inputBuffer]);
  const img = await createImageBitmap(inputBlob);

  // Scale the image so that either width or height becomes `thumbnailMaxSize`
  let width = img.width;
  let height = img.height;
  if (img.width >= img.height) {
    width = thumbnailMaxSize;
    height = (thumbnailMaxSize * img.height) / img.width;
  } else {
    height = thumbnailMaxSize;
    width = (thumbnailMaxSize * img.width) / img.height;
  }

  const canvas = new OffscreenCanvas(width, height);

  const ctx2D = canvas.getContext('2d');
  if (!ctx2D) {
    console.warn('No canvas context 2D (should never happen)');
    return null;
  }

  ctx2D.drawImage(img, 0, 0, width, height);

  const thumbBlob = await canvas.convertToBlob({ type: `image/${thumbnailFormat}`, quality: 0.75 });
  const reader = new FileReaderSync();
  return reader.readAsArrayBuffer(thumbBlob);
};
