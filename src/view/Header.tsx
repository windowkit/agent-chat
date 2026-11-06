// The session's line: which agent and model, the mode and model pickers
// where the harness has them, what the session has cost, and Copy for the
// whole transcript.

import type { ReactElement } from 'react';
import { Button, Select, useClipboard } from 'react-x11';

import { useChat } from './context.js';
import { useLook } from './look.js';
import { useSessionSnapshot } from './use-agent.js';

export function Header(): ReactElement {
  const { session } = useChat();
  const snap = useSessionSnapshot(session);
  const look = useLook();
  const clipboard = useClipboard();
  const { info, capabilities } = snap;
  const cost = info.usage?.costUsd;
  return (
    <box
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 12,
        paddingRight: 8,
        paddingTop: 6,
        paddingBottom: 6,
        borderBottomWidth: 1,
        borderBottomColor: look.border,
      }}
    >
      <text style={{ color: look.text, fontWeight: 'bold' }}>
        {agentName(info.agent)}
      </text>
      {info.model && !(capabilities.models && info.models.length) ? (
        <text style={{ color: look.muted, fontSize: 12 }}>{info.model}</text>
      ) : null}
      <box style={{ flexGrow: 1 }} />
      {capabilities.models && info.models.length ? (
        <Select
          value={info.model}
          options={info.models.map((m) => ({ value: m.id, label: m.label }))}
          onChange={(ev) => void session.setModel(String(ev.value))}
        />
      ) : null}
      {capabilities.modes && info.modes.length ? (
        <Select
          value={info.mode}
          options={info.modes.map((m) => ({ value: m.id, label: m.label }))}
          onChange={(ev) => void session.setMode(String(ev.value))}
        />
      ) : null}
      {cost !== undefined ? (
        <text
          style={{ color: look.muted, fontSize: 12 }}
        >{`$${cost.toFixed(2)}`}</text>
      ) : null}
      <Button
        size="small"
        variant="ghost"
        label="Copy chat"
        onPress={() => void clipboard.writeText(session.toMarkdown())}
      />
    </box>
  );
}

function agentName(agent: string): string {
  return agent === 'claude'
    ? 'Claude'
    : agent.charAt(0).toUpperCase() + agent.slice(1);
}
