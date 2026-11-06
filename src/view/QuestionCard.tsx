// A question the agent asked: options as buttons, one or several a
// question, and Submit once every question has an answer.

import { memo, useState, type ReactElement } from 'react';
import { Button } from 'react-x11';

import type { QuestionPart } from '../core/types.js';
import { useChat } from './context.js';
import { useLook } from './look.js';

export const QuestionCard = memo(function QuestionCard({
  part,
}: {
  part: QuestionPart;
}): ReactElement {
  const { session } = useChat();
  const look = useLook();
  const [chosen, setChosen] = useState<Record<string, readonly string[]>>({});
  const open = part.state === 'open';
  const complete = part.questions.every(
    (q) => (chosen[q.question]?.length ?? 0) > 0,
  );

  const pick = (question: string, label: string, multi: boolean) =>
    setChosen((c) => {
      const now = c[question] ?? [];
      const next = multi
        ? now.includes(label)
          ? now.filter((l) => l !== label)
          : [...now, label]
        : [label];
      return { ...c, [question]: next };
    });

  return (
    <box
      style={{
        flexDirection: 'column',
        gap: 10,
        padding: 10,
        borderWidth: 1,
        borderColor: open ? look.accent : look.border,
        borderRadius: 6,
      }}
    >
      {part.questions.map((q) => (
        <box key={q.question} style={{ flexDirection: 'column', gap: 6 }}>
          {q.header ? (
            <text style={{ color: look.muted, fontSize: 11 }}>{q.header}</text>
          ) : null}
          <text style={{ color: look.text, fontWeight: 'bold' }}>
            {q.question}
          </text>
          {open ? (
            <box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {q.options.map((o) => {
                const on = chosen[q.question]?.includes(o.label) ?? false;
                return (
                  <Button
                    key={o.label}
                    size="small"
                    label={o.label}
                    variant={on ? 'solid' : 'outline'}
                    primary={on}
                    onPress={() => pick(q.question, o.label, q.multiSelect)}
                  />
                );
              })}
            </box>
          ) : (
            <text style={{ color: look.muted }}>
              {part.answers?.[q.question] ??
                (part.state === 'cancelled' ? 'Dismissed' : '')}
            </text>
          )}
        </box>
      ))}
      {open ? (
        <box style={{ flexDirection: 'row', gap: 6 }}>
          <Button
            size="small"
            primary
            label="Submit"
            disabled={!complete}
            onPress={() =>
              session.answer(
                part.id,
                Object.fromEntries(
                  part.questions.map((q) => [
                    q.question,
                    (chosen[q.question] ?? []).join(', '),
                  ]),
                ),
              )
            }
          />
          <Button
            size="small"
            variant="ghost"
            label="Dismiss"
            onPress={() => session.answer(part.id, null)}
          />
        </box>
      ) : null}
    </box>
  );
});
