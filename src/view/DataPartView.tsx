// A data part, drawn by its name. The names are the ones this package's
// drivers write (`DataValues`); a part named anything else, or with a value
// that is not the shape its name says, draws nothing.

import type { ReactElement } from 'react';

import type { DataPart, DataValues } from '../core/types.js';
import { ArtifactCard } from './ArtifactCard.js';
import { AttachmentCard } from './AttachmentCard.js';
import { PullRequestCard } from './PullRequestCard.js';
import { SessionCard } from './SessionCard.js';

export function DataPartView({
  part,
}: {
  part: DataPart;
}): ReactElement | null {
  const v = part.value as Record<string, unknown> | null | undefined;
  if (!v || typeof v !== 'object') return null;
  switch (part.name) {
    case 'pull-request':
      return typeof v.number === 'number' && typeof v.action === 'string' ? (
        <PullRequestCard value={v as unknown as DataValues['pull-request']} />
      ) : null;
    case 'session':
      return typeof v.url === 'string' ? (
        <SessionCard value={v as unknown as DataValues['session']} />
      ) : null;
    case 'artifact':
      return typeof v.url === 'string' ? (
        <ArtifactCard value={v as unknown as DataValues['artifact']} />
      ) : null;
    case 'attachments':
      return Array.isArray(v.files) ? (
        <AttachmentCard value={v as unknown as DataValues['attachments']} />
      ) : null;
    default:
      return null;
  }
}
