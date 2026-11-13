// A page the agent published: the Artifact tool's `url`, `title` and the
// file it came from.

import type { ReactElement } from 'react';

import type { ArtifactData } from '../core/types.js';
import { LinkCard, shortUrl } from './LinkCard.js';

export function ArtifactCard({ value }: { value: ArtifactData }): ReactElement {
  return (
    <LinkCard
      kind="Published"
      title={value.title ?? value.path ?? shortUrl(value.url)}
      detail={[value.path, shortUrl(value.url)].filter(Boolean).join(' · ')}
      href={value.url}
    />
  );
}
