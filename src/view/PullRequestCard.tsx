// A pull request a command opened, edited or merged: Bash's
// `gitOperation.pr`.

import type { ReactElement } from 'react';

import type { PullRequestData } from '../core/types.js';
import { LinkCard, shortUrl } from './LinkCard.js';

export function PullRequestCard({
  value,
}: {
  value: PullRequestData;
}): ReactElement {
  const action = value.action.replace(/-/g, ' ');
  return (
    <LinkCard
      kind="Pull request"
      title={`#${value.number}`}
      detail={[
        action.charAt(0).toUpperCase() + action.slice(1),
        value.url ? shortUrl(value.url) : '',
      ]
        .filter(Boolean)
        .join(' · ')}
      {...(value.url ? { href: value.url } : {})}
    />
  );
}
