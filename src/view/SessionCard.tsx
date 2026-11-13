// An agent session started somewhere else — a cloud session the Agent tool
// launched, a workflow — which the user can open and follow.

import type { ReactElement } from 'react';

import type { SessionLinkData } from '../core/types.js';
import { LinkCard, shortUrl } from './LinkCard.js';

export function SessionCard({
  value,
}: {
  value: SessionLinkData;
}): ReactElement {
  return (
    <LinkCard
      kind="Session started"
      title={value.title ?? 'A new session'}
      detail={shortUrl(value.url)}
      href={value.url}
    />
  );
}
