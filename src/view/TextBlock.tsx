// Assistant text: markdown, with each top-level fence drawn as a code block
// that carries actions, or by the app's renderer for its language.

import { memo, useMemo, type ReactElement } from 'react';
import { Markdown } from '@react-x11/components/markdown';

import type { AgentMessage } from '../core/types.js';
import { CodeBlock } from './CodeBlock.js';
import { useChat } from './context.js';
import { useCodeLook } from './look.js';
import { splitFences } from './fences.js';

export interface TextBlockProps {
  text: string;
  streaming: boolean;
  message: AgentMessage;
}

export const TextBlock = memo(function TextBlock({
  text,
  streaming,
  message,
}: TextBlockProps): ReactElement {
  const { fences, components, onLink, fontSize } = useChat();
  // segments alternate prose and fences: the gap is the space a fence keeps
  const { spacing } = useCodeLook(fontSize);
  const segments = useMemo(
    () => splitFences(text, streaming),
    [text, streaming],
  );
  const link = useMemo(
    () => (onLink ? (href: string) => onLink(href) : undefined),
    [onLink],
  );
  return (
    <box style={{ flexDirection: 'column', gap: spacing }}>
      {segments.map((s, i) => {
        if (s.type === 'prose') {
          return (
            <Markdown
              key={i}
              source={s.text}
              partial={streaming && i === segments.length - 1}
              {...(fences ? { fences } : {})}
              {...(components ? { components } : {})}
              {...(link ? { onLink: link } : {})}
              {...(fontSize ? { fontSize } : {})}
            />
          );
        }
        const fence = { lang: s.lang, text: s.text, partial: s.partial };
        const custom = fences?.[s.lang];
        return custom ? (
          <box key={i}>{custom(fence)}</box>
        ) : (
          <CodeBlock key={i} fence={fence} message={message} />
        );
      })}
    </box>
  );
});
