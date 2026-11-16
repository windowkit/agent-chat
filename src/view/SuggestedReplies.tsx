// What the harness suggests the user might say next, as chips under the
// last reply. By default pressing one puts it in the composer to edit or
// send; `<AgentChat suggestions="send">` sends it, and a function there is
// the app's own action.

import type { ReactElement } from 'react';
import { Button } from 'react-x11';

import { useChat } from './context.js';
import { useLook } from './look.js';

export function SuggestedReplies({
  suggestions,
}: {
  suggestions: readonly string[];
}): ReactElement {
  const { suggest } = useChat();
  const look = useLook();
  return (
    <box
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: look.gap }}
      aria-label="Suggested replies"
    >
      {suggestions.map((s) => (
        <Button
          key={s}
          size="small"
          variant="outline"
          label={s}
          onPress={() => suggest(s)}
        />
      ))}
    </box>
  );
}
