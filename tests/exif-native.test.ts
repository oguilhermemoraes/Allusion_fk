import {
  NativeExifData,
  nativeToDimensions,
  nativeToExifTags,
} from '../common/exif-native';

describe('exif-native mapping', () => {
  const sample: NativeExifData = {
    make: 'Canon',
    model: 'EOS 5D Mark IV',
    lens: 'EF24-70mm f/2.8L II USM',
    iso: 800,
    fNumber: 2.8,
    exposureTime: '1/250',
    focalLength: '50.0 mm',
    software: 'Adobe Photoshop 24.0',
    artist: 'Jane Doe',
    copyright: '2026 Jane Doe',
    imageDescription: 'Test image',
    width: 1920,
    height: 1080,
  };

  test('nativeToDimensions returns width and height', () => {
    expect(nativeToDimensions(sample)).toEqual({ width: 1920, height: 1080 });
  });

  test('nativeToDimensions returns zeros when data is missing', () => {
    expect(nativeToDimensions(undefined)).toEqual({ width: 0, height: 0 });
    expect(nativeToDimensions(null)).toEqual({ width: 0, height: 0 });
    expect(nativeToDimensions({})).toEqual({ width: 0, height: 0 });
  });

  test('nativeToExifTags maps requested tags to native fields', () => {
    const result = nativeToExifTags(sample, [
      'Make',
      'Model',
      'FNumber',
      'ExposureTime',
      'FocalLength',
    ]);
    expect(result).toEqual(['Canon', 'EOS 5D Mark IV', '2.8', '1/250', '50.0 mm']);
  });

  test('nativeToExifTags returns undefined for unknown tags', () => {
    const result = nativeToExifTags(sample, ['GPSLatitude', 'Megapixels']);
    expect(result).toEqual([undefined, undefined]);
  });

  test('nativeToExifTags returns undefined for every tag when data is missing', () => {
    const result = nativeToExifTags(undefined, ['Make', 'Model']);
    expect(result).toEqual([undefined, undefined]);
  });

  test('nativeToExifTags formats numeric fields as strings', () => {
    const result = nativeToExifTags({ iso: 800, width: 1920, height: 1080 }, [
      'ISO',
      'ImageWidth',
      'ImageHeight',
    ]);
    expect(result).toEqual(['800', '1920', '1080']);
  });
});
