// The agent's plan as a checklist: Claude Code's task list (or a
// `TodoWrite`), kept current as it works — what is done in the muted
// colour, what is under way in bold, and how far along it is.

import type { ReactElement } from 'react';
import { Icon } from 'react-x11';

import type { PlanPart } from '../core/types.js';
import { useLook } from './look.js';

export function PlanChecklist({ part }: { part: PlanPart }): ReactElement {
  const look = useLook();
  const done = part.entries.filter((e) => e.status === 'completed').length;
  return (
    <box style={{ flexDirection: 'column', gap: 2 }} aria-label="Plan">
      <text
        style={{
          color: look.muted,
          fontSize: look.smallSize,
          fontWeight: 'bold',
        }}
      >
        {`PLAN · ${done} OF ${part.entries.length} DONE`}
      </text>
      {part.entries.map((e, i) => (
        <box
          key={i}
          style={{ flexDirection: 'row', gap: look.gap, alignItems: 'center' }}
        >
          {e.status === 'completed' ? (
            <Icon name="check" size={look.captionSize} color={look.success} />
          ) : e.status === 'in_progress' ? (
            <Icon name="dot" size={look.captionSize} color={look.accent} />
          ) : (
            <Icon name="dash" size={look.captionSize} color={look.muted} />
          )}
          <text
            style={{
              color: e.status === 'completed' ? look.muted : look.text,
              fontWeight: e.status === 'in_progress' ? 'bold' : 'normal',
            }}
          >
            {e.text}
          </text>
        </box>
      ))}
    </box>
  );
}
