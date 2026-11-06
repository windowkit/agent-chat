# AGENTS.md

Guidance for AI agents (and new contributors) working on
`@windowkit/agent-chat`.

## What this package is

`<AgentChat>`: a chat with a local agent harness — Claude Code first — for
[react-x11](https://github.com/sidorares/react-x11) apps. It is built on
`@react-x11/components` (`<Markdown>`, `<Code>`, `<TerminalOutput>`,
`<RichTextEditor>`), which is why it is a package of its own: no component in
that package may import another, and this one composes four. That boundary,
and everything else that was decided before a line was written, is in
[docs/design.md](docs/design.md). Read it before changing the shape of
anything.

## Layout

- `src/core/` — **no React, no renderer.** The message model (`types.ts`), the
  transcript reducer (`reducer.ts`, pure), the session store (`session.ts`),
  the permission policy (`policy.ts`, pure), the tool helpers (`tools.ts`)
  and the driver seam (`driver.ts`). Exported as `./core`.
- `src/drivers/<name>/` — one directory per harness, each its own subpath,
  reached from the core by a dynamic `import()` so a bundle carries the one it
  uses. No React here either.
- `src/testing/` — `fakeDriver`: a script played through the real session.
  Every view test and the demo run on it.
- `src/view/` — `<AgentChat>` and its parts, in TSX.
- `test/` — `node --test` through `tsx`. `*.test.ts` for the core and the
  drivers, `*.test.tsx` for the view, rendered by react-x11's in-process X
  server.
- `examples/` — runnable apps. `demo.tsx` needs nothing installed; the
  others need the Claude Agent SDK and a key.
- `scripts/` — `check-package.ts` (what would be published) and
  `screenshot.tsx` (the README's images).
- `docs/` — the reference, the drivers page and the design record.

`scripts/check-package.ts` enforces the two layering rules: `./core`,
`./drivers/*` and `./testing` import no React and no renderer, and no
emitted `.d.ts` names a Node type or ProseMirror's.

## Rules

- **Parts are plain data.** A part never holds a function, a class or a
  handle into the driver. Anything a part needs to do — answer an approval,
  answer a question — is a session method keyed by the part's id. That is what
  lets the view memoize by identity, a test compare transcripts, and a
  recorder write a session to JSONL.
- **Drivers report deltas, never snapshots**, and the reducer accumulates.
  A driver that re-sends whole content is how a tool part vanishes.
- **An event touches only a turn still under way.** A driver's ids are
  unique within a turn, not across a session — the demo's script names its
  calls, and every reply runs it — so the reducer looks parts up in messages
  that are not `done` (`findLivePart`). Looked up across the transcript, a
  second turn's tool call updated the first turn's card, and its approval
  row appeared there.
- **The reducer replaces only what a change touched.** A streamed token
  replaces one part, its message and the array; every other message is the
  object it was. `MessageView` is memoized on that.
- **The gate never waits on the user; `approve` does.** A harness hook has a
  timeout, an approval does not. `DriverHost.gate` is the app's
  `onToolCall` and the policy, fast; `DriverHost.approve` is the approval
  row, and holds while paused. A driver whose harness asks through a hook
  answers `ask` there and routes the call to its untimed callback.
- **An action is drawn only where it works.** Every capability a driver
  lacks hides a control (`snapshot.capabilities`); it never changes what a
  prop means.
- **Nothing runs or navigates by itself.** No default action executes code;
  `components` reaches only the keys given; `<Markdown scope>` is never
  passed, because a reply is a document nobody here wrote.
- **A harness that cannot run is `AgentUnavailableError`**, an ordinary
  state of a healthy machine: `status: 'unavailable'` and the `fallback`,
  never a crash.
- **The Claude Agent SDK is an optional peer and a devDependency.** The
  peer is for apps (and keeps the import resolvable under pnpm); the
  devDependency is so this repository's examples run after `npm install`.
  npm installs no optional peer of the project itself, even named with
  `--no-save`, which printed "up to date" and left the SDK out. No test
  imports it: the driver's tests hand it a fake, and the missing-SDK test
  names a module that does not exist, since the real import would start
  Claude Code.
- **An optional dependency's types are ours.** The Claude Agent SDK is an
  optional peer; `src/drivers/claude/sdk.ts` writes out the slice the driver
  uses and loads the package with a specifier the compiler cannot follow. An
  `import type` from it would make an app that never installed it fail to
  type-check.
- **Components by subpath only** (`@react-x11/components/markdown`), never
  the barrel. `<RichTextEditor>`'s declarations name DOM globals;
  `src/view/dom-globals.d.ts` declares the four for this project, and nothing
  public may name an editor type.

## Peers and the floor

`react`, `react-x11` and `@react-x11/components` are peer dependencies, and
they have to be: `registerElement` throws when a second copy of
`@react-x11/components` registers `<richtext>` again, and a second
react-x11 would hold the registrations in the wrong copy.

The `@react-x11/components` range is `^0.37.0 || ^0.38.0`. The hybrid
composer props (`markup`, `composerSchema`, `pasteAsAttachment`, `recall`,
`composerParts`) arrive in 0.38.0 and are **read at run time** in
`src/view/Composer.tsx`, so 0.37 gets a plain text composer. When the floor
moves to 0.38: type the props, delete the detection, and narrow the range.

`<Markdown codeActions>` is the planned home for code block buttons. Until it
ships, `src/view/fences.ts` cuts a reply at its top-level fences and
`CodeBlock` draws the header. When it ships, delete the split and pass the
actions through.

## Commands

```bash
npm test              # tsx --test; headless, no display
npm run typecheck     # src, test, examples, scripts
npm run build         # tsc -p tsconfig.build.json: src -> dist
npm run check:package # after a build
npm run format:check
npm run screenshots   # docs/img/chat-{light,dark}.png
npm run examples:demo # DEMO_AGENT=claude for real Claude Code; see its header
```

## Tests

- **No real harness in CI.** The view and the core run on `fakeDriver`; the
  Claude driver runs against a fake SDK (`test/claude.test.ts`) that plays
  Claude Code's side — the hook, then `canUseTool`, then the tool's handler —
  in the order Claude Code calls them.
- **Wait on a condition, never a clock.** `test/helpers.ts`'s `until`
  checks after each turn of the event loop, up to a count of turns.
- **`<Markdown>` draws into `<richtext>` runs**, which the harness's text
  queries do not read: `richText()` in `test/view.test.tsx` reads them.
- **Click a button by its role** (`findByRole('button', { name, exact })`).
- **The chat fills what it is put in.** It once rendered as tall as its
  composer, the transcript 0 px high and every card clipped above it; a view
  test is how that was found.

## Pull requests and releases

Conventional commits; release-please opens the release PR on `master`, and
merging it publishes with npm trusted publishing (OIDC). The first publish of
a package cannot go through trusted publishing and is done by hand once. PR
screenshots are rendered by the PR's own code (`npm run screenshots`) and
uploaded with `gh-attach`, not committed, unless they belong in the README.
