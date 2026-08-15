import fse from 'fs-extra';
import React, { ReactNode, useEffect, useState } from 'react';

import { formatDateTime, humanFileSize } from 'common/fmt';
import { useStore } from '../contexts/StoreContext';
import { ClientFile } from '../entities/File';
import { usePromise } from '../hooks/usePromise';
import ExternalLink from './ExternalLink';

type CommonMetadata = {
  name: string;
  dimensions: string;
  size: string;
  imported: string;
  created: string;
  modified: string;
};

const commonMetadataLabels: Record<keyof CommonMetadata, string> = {
  name: 'Filename',
  dimensions: 'Dimensions',
  size: 'Size',
  imported: 'Imported',
  // TODO: modified in allusion vs modified in system?
  created: 'Created',
  modified: 'Modified',
};

type ExifField = { label: string; format?: (val: string) => ReactNode };

// Details: https://www.vcode.no/web/resource.nsf/ii2lnug/642.htm
// Camera/lens/GPS EXIF fields were removed for the Allusion Next designer niche (#51);
// the Inspector shows only basic + authorship metadata.
const exifFields: Record<string, ExifField> = {
  PhotometricInterpretation: { label: 'Color Mode' },
  BitsPerSample: { label: 'Bit Depth' },
  Software: { label: 'Creation Software' },
  Artist: { label: 'Creator' },
  CreatorWorkURL: {
    label: 'Creator URL',
    format: function CreatorURL(url?: string) {
      if (!url) {
        return ' ';
      }
      return <ExternalLink url={url}>{url}</ExternalLink>;
    },
  },
  ImageDescription: { label: 'Description' },
  Parameters: { label: 'Parameters' },
  Copyright: { label: 'Copyright' },
};

const exifTags = Object.keys(exifFields);

interface ImageInfoProps {
  file: ClientFile;
}

const ImageInfo = ({ file }: ImageInfoProps) => {
  const { exifTool } = useStore();

  const modified = usePromise(file.absolutePath, async (filePath) => {
    const stats = await fse.stat(filePath);
    return formatDateTime(stats.ctime);
  });

  const fileStats: CommonMetadata = {
    name: file.name,
    dimensions: `${file.width || '?'} x ${file.height || '?'}`,
    size: humanFileSize(file.size),
    imported: formatDateTime(file.dateAdded),
    created: formatDateTime(file.dateCreated),
    modified: modified.tag === 'ready' && 'ok' in modified.value ? modified.value.ok : '...',
  };

  const [exifStats, setExifStats] = useState<Record<string, string>>({});
  useEffect(() => {
    // When the file changes, reset previous fields to empty string, so the re-render doesn't flicker as when setting it to {}
    setExifStats(
      Object.entries(exifStats).reduce(
        (acc, [key, val]) => ({ ...acc, [key]: val ? ' ' : '' }),
        {},
      ),
    );

    exifTool.readExifTags(file.absolutePath, exifTags).then((tagValues) => {
      const stats: Record<string, string> = {};
      tagValues.forEach((val, i) => {
        const key = exifTags[i];
        stats[key] = val || '';
      });
      setExifStats(stats);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.absolutePath]);

  // Todo: Would be nice to also add tooltips explaining what these mean (e.g. diff between dimensions & resolution)
  // Or add the units: pixels vs DPI
  return (
    <div>
      <header>
        <h2>Information</h2>
      </header>
      <table id="file-info">
        <tbody>
          {Object.entries(commonMetadataLabels).map(([field, label]) => (
            <tr key={field}>
              <th scope="row">{label}</th>
              <td>{fileStats[field as keyof CommonMetadata]}</td>
            </tr>
          ))}
          {Object.entries(exifFields).map(([key, field]) => {
            const value = exifStats[key];
            if (!value) {
              return null;
            }
            return (
              <tr key={key}>
                <th scope="row">{field.label}</th>
                <td>{field.format?.(value || '') || value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default React.memo(ImageInfo);
