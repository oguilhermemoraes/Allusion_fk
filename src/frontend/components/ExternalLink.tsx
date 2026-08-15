import { openExternal } from 'src/frontend/services/shell';
import React, { ReactNode } from 'react';

type ExternalLinkProps = {
  url: string;
  children: ReactNode;
};

/** Opens link in default app. */
const ExternalLink = ({ url, children }: ExternalLinkProps) => {
  return (
    <a
      href={url}
      title={url}
      rel="noreferrer"
      target="_blank"
      onClickCapture={(event) => {
        event.preventDefault();
        openExternal(url);
      }}
    >
      {children}
    </a>
  );
};

export default ExternalLink;
