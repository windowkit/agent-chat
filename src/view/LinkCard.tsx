// The frame every link card shares: what the link is, its title, where it
// goes, and an Open button that hands the address to the app's `onLink`.
// Without `onLink` there is no button — nothing here navigates by itself —
// and the address is still there to read.

import type { ReactElement } from 'react';
import { Button } from 'react-x11';

import { useChat } from './context.js';
import { useLook } from './look.js';

export interface LinkCardProps {
  /** What kind of link: `Pull request`, `Session`, `Artifact`. */
  kind: string;
  title: string;
  /** A line under the title: what happened, where it is. */
  detail?: string;
  /** Where Open goes. Absent: no button. */
  href?: string;
}

export function LinkCard({
  kind,
  title,
  detail,
  href,
}: LinkCardProps): ReactElement {
  const { onLink } = useChat();
  const look = useLook();
  return (
    <box
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: look.inset,
        padding: look.inset,
        borderWidth: 1,
        borderColor: look.border,
        borderRadius: look.radius,
      }}
      aria-label={`${kind}: ${title}`}
    >
      {/* the accent edge: a stripe, since a border of one side is square */}
      <box
        style={{
          width: 3,
          alignSelf: 'stretch',
          borderRadius: 2,
          backgroundColor: look.accent,
        }}
      />
      <box
        style={{
          flexDirection: 'column',
          gap: 2,
          flexGrow: 1,
          flexShrink: 1,
        }}
      >
        <text
          style={{
            color: look.muted,
            fontSize: look.smallSize,
            fontWeight: 'bold',
          }}
        >
          {kind.toUpperCase()}
        </text>
        <text style={{ color: look.text, fontWeight: 'bold', maxLines: 2 }}>
          {title}
        </text>
        {detail ? (
          <text
            style={{
              color: look.muted,
              fontSize: look.captionSize,
              maxLines: 1,
            }}
          >
            {detail}
          </text>
        ) : null}
      </box>
      {href && onLink ? (
        <Button
          size="small"
          variant="outline"
          label="Open"
          onPress={() => onLink(href)}
        />
      ) : null}
    </box>
  );
}

/** `github.com/o/r/pull/7` for `https://github.com/o/r/pull/7`. */
export function shortUrl(href: string): string {
  return href.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '');
}
