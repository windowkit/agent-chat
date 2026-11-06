// The app's own tools, as functions, and the app's renderers for what the
// agent writes. The agent gets a small notes store it can list and add to;
// a note it adds is drawn as a card; a ```note fence and a <Note/> tag are
// drawn by the app, and their `describe` lines tell the agent they exist.
//
//   npm install @anthropic-ai/claude-agent-sdk
//   ANTHROPIC_API_KEY=… npm run examples:tools

import { type ReactElement } from 'react';
import { createRoot } from 'react-x11';
import { z } from 'zod';

import { AgentChat, defineTool } from '../src/index.js';

const notes = new Map<string, string>([
  ['groceries', 'eggs, coffee, oat milk'],
  ['ideas', 'a chat UI for local agents'],
]);

const listNotes = defineTool({
  description: 'List the titles of the notes.',
  parameters: z.object({}),
  kind: 'read',
  run: () => [...notes.keys()],
});

const addNote = defineTool({
  description: 'Add a note, or replace one with the same title.',
  parameters: z.object({ title: z.string(), body: z.string() }),
  kind: 'edit',
  ask: true, // the user approves every write
  title: ({ title }) => `Save note “${title}”`,
  run: ({ title, body }) => {
    notes.set(title, body);
    return { title, body };
  },
  render: ({ output }) =>
    output ? <NoteCard title={output.title} body={output.body} /> : null,
});

function NoteCard({
  title,
  body,
}: {
  title: string;
  body: string;
}): ReactElement {
  return (
    <box
      style={{
        flexDirection: 'column',
        padding: 10,
        borderRadius: 8,
        backgroundColor: '#fff8dc',
        borderWidth: 1,
        borderColor: '#e0c97f',
      }}
    >
      <text style={{ fontWeight: 'bold', color: '#5a4a00' }}>{title}</text>
      <text style={{ color: '#5a4a00' }}>{body}</text>
    </box>
  );
}

const root = await createRoot();
root.render(
  <window width={820} height={760} title="Agent chat — tools">
    <AgentChat
      agent="claude"
      settings="isolated"
      coreTools={{ shell: false, edit: false, web: false }}
      instructions="You help the user with their notes. Use the tools; there are no files."
      tools={{ listNotes, addNote }}
      fences={{
        note: {
          describe:
            'a note to show the user: first line its title, the rest its body',
          render: (fence) => {
            const [title = '', ...body] = fence.text.split('\n');
            return <NoteCard title={title} body={body.join('\n')} />;
          },
        },
      }}
      components={{
        Note: {
          describe: '<Note title="…"/> shows the saved note with that title',
          component: ({ title }) => (
            <NoteCard
              title={String(title)}
              body={notes.get(String(title)) ?? '(no such note)'}
            />
          ),
        },
      }}
    />
  </window>,
);
