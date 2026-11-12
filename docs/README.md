# Documentation

- [AgentChat](agent-chat.md) — the component: its props, tools, the gate,
  rendering, intercepting actions, and the session API.
- [Drivers](drivers.md) — what the Claude driver does with the session's
  options, and how to write a driver for another harness.
- [Customising](customising.md) — every seam there is to restyle or replace
  a part of the chat, the parts none reaches, and the design for the rest.
- [What the Claude stream carries](claude-stream.md) — everything the Claude
  Agent SDK's stream can hand a chat, by the component that should draw it,
  and what the chat draws for it today.
- [The design](design.md) — the survey of agent SDKs, protocols and React
  chat libraries behind it, why it is one library over a driver per harness,
  why it lives outside `@react-x11/components`, and the milestones.
