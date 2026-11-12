# Customising AgentChat

`<AgentChat>` should look finished with no configuration, and an app that
wants more should be able to reach any part of it without forking the
package. This page records where that stands: every seam there is today,
the parts of the UI no seam reaches, and a design for closing the gap.

Paths are relative to this repository.

## What there is today

### Content: keyed renderers

These replace how a piece of _content_ is drawn, chosen by what the content
is.

| Seam          | Keyed by                     | Replaces                                                | Notes                                                                                                                                                                                                                                                                              |
| ------------- | ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fences`      | fence language               | a fenced block, in prose and as a top-level code block  | `(fence) => ReactNode`, or `{ render, describe }`. A custom one replaces the whole `CodeBlock`, header and actions included. `describe` adds a line to the system prompt when the chat owns its session.                                                                           |
| `components`  | tag name                     | an MDX-style tag alone on its line, inside `<Markdown>` | Same entry shape as `fences`.                                                                                                                                                                                                                                                      |
| `renderTool`  | tool label, or `'*'`         | the **body** of a tool card                             | Looked up after a tool's own `render` (`ToolCard.tsx:41-44`). Gets `{ part, input, output }`, where `output` is only the first `value` output, so a built-in tool's renderer reads `part.output` itself. The card's frame, title row, subagent thread and approval row stay drawn. |
| tool `render` | an app tool, by `defineTool` | the body of that tool's card                            | As `renderTool`.                                                                                                                                                                                                                                                                   |
| `codeActions` | —                            | the buttons in a code block's header                    | `{ id, label, icon?, doneLabel?, when?, run }`. Top-level fences only. `icon` is declared and never drawn.                                                                                                                                                                         |

### Chrome: whole-part replacements and options

| Seam                       | What it does                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `header`                   | `false`, or `(session) => ReactNode` to replace the whole header. Its pieces, the model and mode selects, cost and Copy chat, are not exported. |
| `empty`                    | What the transcript shows before the first message.                                                                                             |
| `fallback`                 | Drawn instead of the chat when the agent is unavailable. The error banner drawn above a running chat is fixed.                                  |
| `composer`                 | `markup`, `files` (the `@` list), `commands` (the `/` list), `pasteAsAttachment`. No suggesters of the app's own, no buttons, no key bindings.  |
| `placeholder`, `autoFocus` | As named.                                                                                                                                       |
| `fontSize`                 | Reaches the markdown prose **only**: code blocks, tool cards, the header, the composer and every label keep their own sizes.                    |
| `style`                    | The root box.                                                                                                                                   |

### Look: the react-x11 theme

`useLook()` (`src/view/look.ts`) reads react-x11's theme (text, muted,
border, accent, danger, success, warning, mono font) and derives one colour
of its own, the user bubble (7% of the ink). The only way to change any of
it is a `<ThemeProvider>` around the chat, which changes everything inside,
`<Markdown>`, `<Code>` and the buttons included. Chat-only colours, such as
the bubble, a card's border or the diff colours, cannot be set apart.

The theme's shape tokens (`radius`, `radiusSmall`, `borderWidth`,
`fontSize`, `paddingX/Y`) are not read: every radius (6, 8, 10), gap, padding
and small type size (11, 12) in `src/view/` is a literal.

### Behaviour

| Seam                   | What it does                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `onToolCall(call)`     | Runs before policy: allow, allow for the session, deny with a reason, ask, or allow with rewritten input. |
| `permissions`          | `'ask' \| 'edits' \| 'read-only' \| 'auto'`.                                                              |
| `tools`, `coreTools`   | Add the app's own tools; remove, gate or replace a built-in by category.                                  |
| `onLink`               | Links in prose. Nothing navigates without it. Links in tool cards and code are not covered.               |
| `useAgent` + `session` | The session without the view: `send`, `stop`, `respond`, `answer`, `notify`, `snapshot`, `subscribe`…     |
| `AgentDriver`          | A whole harness, or a wrapper around `claudeDriver` that rewrites events.                                 |

### What is exported

`AgentChat`, `useAgent`, `useSessionSnapshot`, the entry and action types,
`copyCode`, `defineTool`, `splitFences` and the core session API. **None of
the view's parts are exported**: `Header`, `Transcript`, `MessageList`,
`TextBlock`, `CodeBlock`, `ToolCard`, `QuestionCard`, `Composer`, `useLook`,
`useChat`. An app cannot rebuild the chat from its pieces; it can only take
the whole thing or start from `useAgent`.

## The gaps

Parts of the chat no seam reaches:

1. **The user bubble**: its width (85%), radius, tint, the queued state and
   the label on a message from another session.
2. **The assistant message**: one Copy button, and no `messageActions` (Edit,
   Retry), which `docs/design.md` designs.
3. **Reasoning**: the collapsed "Thought" row.
4. **The plan checklist**, built from `TodoWrite` only. Claude Code plans with
   `TaskCreate` and `TaskUpdate` today, which draw as plain tool cards (see
   [the stream catalogue](claude-stream.md#planned-tasks)).
5. **Notices** from `session.notify`, and **attachment chips**, drawn as
   `[label]` text.
6. **The question card**, every label in it.
7. **The approval row**: fixed options and labels, and `approval.reason`
   never shown. `docs/design.md` promises a `renderTool` can draw it; it is
   always drawn by the card as well.
8. **The tool card's frame**: the title row, state labels and icons, the
   subagent thread, even with a `renderTool`.
9. **Default tool outputs**: the hand-built diff (old lines, then new), the
   terminal view, the JSON view, `[image, mime]` in place of an image, and
   the line limits (40 to 300).
10. **The code block's frame and header**, and `CodeAction.icon`.
11. **The transcript**: padding, gaps, the activity line's wording, no
    jump-to-bottom control.
12. **The error banner** over a running chat.
13. **The composer's layout**: the button set and labels, the editor's
    radius and height, the suggestion sources, key bindings.
14. **The header's pieces**, reusable only by replacing the whole header.
15. **Every spacing, radius and small type size**, and `fontSize` reaching
    only prose.
16. **`data` parts**: drawn as nothing, and no seam to draw them.
17. **Copy and export formats** (`messageMarkdown`, `transcriptMarkdown`): a
    tool call exports as one line.

## How to provide it

Three questions have different best answers, so the design is three
layers, plus the parts exported for an app that wants to compose its own.

### 1. Tokens: one `look` prop, in ems

Most "make it look like ours" requests are numbers and colours. A `look`
prop, merged over defaults derived from the react-x11 theme, covers them
without anyone replacing a component:

```ts
interface ChatLook {
  fontSize: number; // prose; everything else follows it
  smallSize: number; // labels, states, captions, in ems of fontSize
  lineHeight: number; // prose, × the font's own line
  gap: number; // between messages, in ems
  radius: number; // cards and the bubble, in ems
  bubble: string; // the user message fill
  cardBorder: string;
  diffAdded: string;
  diffRemoved: string;
  // …
}

<AgentChat look={{ fontSize: 15, radius: 0.7, bubble: '#eef' }} />;
```

Sizes in ems of `fontSize`, as the code block's padding and radius are in
@react-x11/components, so one size scales the whole chat in proportion.
Defaults read the theme's own tokens (`radius`, `fontSize`) where it has
them, so a theme that rounds everything rounds the chat too.

### 2. Styles: a `styles` bag per part

For one part's margins, borders or fill, the convention across
@react-x11/components is a `styles` object keyed by part (`<Tree>`,
`<Table>`, `<Markdown>`, `<RichTextEditor>`), merged over each part's own
style. `<AgentChat>` should take the same:

```ts
styles?: {
  transcript?: Style;
  userMessage?: Style;
  assistantMessage?: Style;
  toolCard?: Style;
  codeBlock?: Style;
  composer?: Style;
  // …
};
```

### 3. Parts: a map of components, each handed its default

To change what a part _is_, not how it looks: a `parts` map, one entry
per part in "The gaps", each a component given the part's data **and the
built-in component**, so an override can wrap, decorate or fall back
rather than rebuild:

```tsx
const parts: ChatParts = {
  UserMessage: ({ message, Default }) => (
    <box style={{ flexDirection: 'row', gap: 8 }}>
      <Avatar of={message.from} />
      <Default message={message} />
    </box>
  ),
  Approval: ({ request, respond, Default }) =>
    request.kind === 'edit' ? (
      <EditApproval request={request} respond={respond} />
    ) : (
      <Default request={request} respond={respond} />
    ),
};

<AgentChat parts={parts} />;
```

Why a map over a render prop per part:

- **There are about fifteen parts.** A `renderUserMessage`,
  `renderReasoning`, `renderApproval`… prop each is fifteen props to
  document, and every new part is a new prop. A map is one prop, one
  type, and grows without the component's signature changing.
- **`Default` makes overriding additive.** The common override is "the
  same, plus a thing": an avatar, a badge, one more button. Handed the
  built-in, an app writes that much and no more, and keeps every fix to the
  default it did not touch.
- **Components, not functions**, so a part can use hooks (`useChat`,
  `useLook`) and React keys and memoizes it as it does any component.
- It is the shape apps know: react-markdown's `components`, MUI's `slots`.

The name can't be `components`: that prop already maps MDX tags to
components. `parts` or `slots`.

Render props stay where the key is **data**: a fence by its language, a
tool by its label, a `data` part by its type. Those are open-ended sets
keyed by strings, which is what `fences` and `renderTool` already are. Two
extensions:

- `renderTool` keyed by tool label, then by **kind** (`execute`, `edit`,
  `read`…), then by **output type** (`terminal`, `diff`, `image`), then
  `'*'`. One renderer for every diff, without listing Edit, Write and
  MultiEdit.
- `renderData` for `data` parts by their type: the stream carries far more
  than text and tool calls (see [the stream catalogue](claude-stream.md)),
  and a driver that keeps it needs somewhere to send it.

And action lists, as `codeActions` is: `messageActions` (Copy, Edit, Retry,
the app's own) and `approvalOptions`.

### 4. The parts, exported

Every default part exported, with `useChat` and `useLook`, so an app that
wants a layout of its own (the transcript in one pane, the composer in a
toolbar) composes the same pieces `<AgentChat>` does, around `useAgent`.
That is the same promise as a `Default` in `parts`, one level up.

### Order of work

1. `look`, and every literal in `src/view/` read from it: the most visible
   improvement for the least API.
2. Export the parts, `useChat` and `useLook`.
3. `parts`, with `Default`; `styles`.
4. `renderTool` by kind and output type; `renderData`; `messageActions`;
   `approvalOptions`.
5. The Claude driver keeping what it drops today (see the catalogue).

Each step adds API and removes none, so the simple case stays one line:
`<AgentChat cwd={dir} />`.
