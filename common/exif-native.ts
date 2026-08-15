/** Tipos e mapeamentos para leitura nativa de EXIF via Tauri (`read_exif_metadata`). */

export interface NativeExifData {
  make?: string;
  model?: string;
  lens?: string;
  iso?: number;
  fNumber?: number;
  exposureTime?: string;
  focalLength?: string;
  software?: string;
  artist?: string;
  copyright?: string;
  imageDescription?: string;
  width?: number;
  height?: number;
}

/** Mapeia campos nativos para o nome de tag usado no ImageInfo (estilo ExifTool). */
const TAG_FIELD_MAP: Readonly<Record<string, keyof NativeExifData | undefined>> = {
  Make: 'make',
  Model: 'model',
  LensModel: 'lens',
  ISO: 'iso',
  PhotographicSensitivity: 'iso',
  FNumber: 'fNumber',
  ExposureTime: 'exposureTime',
  FocalLength: 'focalLength',
  Software: 'software',
  Artist: 'artist',
  Copyright: 'copyright',
  ImageDescription: 'imageDescription',
  ImageWidth: 'width',
  ImageHeight: 'height',
};

export function nativeToDimensions(data: NativeExifData | null | undefined): {
  width: number;
  height: number;
} {
  return { width: data?.width || 0, height: data?.height || 0 };
}

export function nativeToExifTags(
  data: NativeExifData | null | undefined,
  tags: string[],
): (string | undefined)[] {
  if (!data) {
    return tags.map(() => undefined);
  }
  return tags.map((tag) => {
    const field = TAG_FIELD_MAP[tag];
    if (!field) {
      return undefined;
    }
    const value = data[field] as string | number | null | undefined;
    return value == null ? undefined : String(value);
  });
}
