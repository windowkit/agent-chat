// Generative UI: the agent answers with charts it composes from the app's
// catalogue, drawn in the conversation as it writes them.
//
// The catalogue (`charts/catalog.tsx`) is json-render's: metrics, cards,
// bar, line and area charts from `@react-x11/components/charts`, and a
// button whose press asks the agent a follow-up. `charts/spec-tool.tsx`
// turns it into one app tool, `show`. The tool's parameters are the
// catalogue, and with `card: false` the chat draws the call as the UI
// itself rather than as a tool card. The spec streams in with the tool's
// arguments, so the UI is built while the model writes it.
//
//   npm run examples:charts
//
// runs a scripted agent: nothing installed, no key. Ask anything, then
// press the buttons it draws. Over real Claude Code, where the model
// composes the specs itself:
//
//   DEMO_AGENT=claude npm run examples:charts
//
// Claude works read-only in `DEMO_CWD`, or in this directory if that is not
// set, so it can chart what it finds there: "chart the lines of code in
// each directory of src". Authentication is Claude Code's own.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactElement,
} from 'react';
import { createRoot } from 'react-x11';

import { AgentChat, useAgent } from '../src/index.js';
import { fakeDriver, type FakeStep } from '../src/testing/index.js';
import { catalog, events, registry } from './charts/catalog.js';
import { specTool } from './charts/spec-tool.js';

const CLAUDE = process.env.DEMO_AGENT === 'claude';
const CWD = process.env.DEMO_CWD ?? process.cwd();

/** How a pressed button reaches the session: `ask` sends its prompt. */
const Send = createContext<(text: string) => void>(() => {});

export const show = specTool({
  catalog,
  registry,
  events,
  description:
    'Show the user numbers as a UI: headline metrics, bar, line and area ' +
    'charts, and buttons that ask you a follow-up. Use it when the answer ' +
    'is data worth seeing, such as a comparison, a trend or a breakdown, ' +
    'instead of writing a table or a list of figures. Say what the ' +
    'numbers mean in your reply, not in the UI: a Text element is for a ' +
    'caption or a footnote.',
  useActions: () => {
    const send = useContext(Send);
    return useMemo(
      () => ({ ask: (params) => send(String(params.prompt ?? '')) }),
      [send],
    );
  },
});

const AGENT = CLAUDE
  ? { agent: 'claude' as const, cwd: CWD, permissions: 'read-only' as const }
  : {
      agent: fakeDriver((message) => reply(message.text), {
        name: 'charts agent',
      }),
    };

function App(): ReactElement {
  const session = useAgent({ ...AGENT, tools: { show } });
  const send = useCallback((text: string) => session.send(text), [session]);
  return (
    <window
      width={820}
      height={780}
      title={CLAUDE ? `Charts — Claude in ${CWD}` : 'Charts — scripted agent'}
    >
      <box style={{ flexDirection: 'column', flexGrow: 1 }}>
        <Send.Provider value={send}>
          <AgentChat
            session={session}
            placeholder={
              CLAUDE
                ? 'Ask for numbers: “chart the lines of code per directory in src”'
                : 'Ask anything: “how did Q3 go?”'
            }
            empty={
              <text style={{ color: '$textMuted' }}>
                {CLAUDE
                  ? `Claude, reading ${CWD}. Ask for something worth charting.`
                  : 'The scripted agent answers with a Q3 report.'}
              </text>
            }
          />
        </Send.Provider>
      </box>
    </window>
  );
}

// --- the scripted agent -----------------------------------------------------
//
// What a model constrained to the catalogue would call `show` with. The
// specs stream as a model writes them: `chunk` characters at a time.

const STREAM = { chunk: 24, delay: 18 } as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const PRODUCT = [250, 262, 270, 281, 290, 305, 318, 330, 346];
const SERVICES = [80, 82, 85, 84, 86, 88, 90, 91, 92];
const WEEKLY = [18, 21, 19, 24, 22, 26, 25, 23, 27, 29, 26, 31, 33];

const quarter = {
  root: 'q3',
  elements: {
    q3: { type: 'Stack', props: { gap: 12 }, children: ['metrics', 'trend'] },
    metrics: {
      type: 'Row',
      props: {},
      children: ['revenue', 'customers', 'deal'],
    },
    revenue: {
      type: 'Metric',
      props: { label: 'Revenue', value: '$1.27M', delta: '+11.7% on Q2' },
    },
    customers: {
      type: 'Metric',
      props: { label: 'New customers', value: '324', delta: '+14%' },
    },
    deal: {
      type: 'Metric',
      props: { label: 'Average deal', value: '$3.9K', delta: '-3%' },
    },
    trend: {
      type: 'Card',
      props: { title: 'Revenue by month', subtitle: 'Thousands of dollars' },
      children: ['area', 'next'],
    },
    area: {
      type: 'AreaChart',
      props: {
        x: 'month',
        series: [
          { key: 'product', label: 'Product' },
          { key: 'services', label: 'Services' },
        ],
        stacked: true,
        data: MONTHS.map((month, i) => ({
          month,
          product: PRODUCT[i]!,
          services: SERVICES[i]!,
        })),
      },
    },
    next: { type: 'Row', props: { gap: 8 }, children: ['region', 'weekly'] },
    region: {
      type: 'Button',
      props: { label: 'Break down by region', primary: true },
      on: {
        press: {
          action: 'ask',
          params: { prompt: 'Break Q3 revenue down by region' },
        },
      },
    },
    weekly: {
      type: 'Button',
      props: { label: 'New customers by week' },
      on: {
        press: {
          action: 'ask',
          params: { prompt: 'Show new customers by week in Q3' },
        },
      },
    },
  },
};

const regions = {
  root: 'card',
  elements: {
    card: {
      type: 'Card',
      props: { title: 'Revenue by region', subtitle: 'Q2 against Q3, $K' },
      children: ['bars', 'growth'],
    },
    bars: {
      type: 'BarChart',
      props: {
        x: 'region',
        series: [
          { key: 'q2', label: 'Q2', color: '$textMuted' },
          { key: 'q3', label: 'Q3', color: '$accent' },
        ],
        data: [
          { region: 'Americas', q2: 520, q3: 560 },
          { region: 'EMEA', q2: 380, q3: 452 },
          { region: 'APAC', q2: 234, q3: 255 },
        ],
      },
    },
    growth: {
      type: 'Row',
      props: {},
      children: ['americas', 'emea', 'apac'],
    },
    americas: {
      type: 'Metric',
      props: { label: 'Americas', value: '$560K', delta: '+7.7%' },
    },
    emea: {
      type: 'Metric',
      props: { label: 'EMEA', value: '$452K', delta: '+18.9%' },
    },
    apac: {
      type: 'Metric',
      props: { label: 'APAC', value: '$255K', delta: '+9.0%' },
    },
  },
};

const weekly = {
  root: 'card',
  elements: {
    card: {
      type: 'Card',
      props: { title: 'New customers by week', subtitle: 'Q3, 13 weeks' },
      children: ['line', 'note'],
    },
    line: {
      type: 'LineChart',
      props: {
        x: 'week',
        series: [{ key: 'customers', label: 'New customers' }],
        height: 160,
        data: WEEKLY.map((customers, i) => ({ week: `W${i + 1}`, customers })),
      },
    },
    note: {
      type: 'Text',
      props: {
        text: 'Up from 18 in the first week to 33 in the last.',
        tone: 'muted',
        size: 'small',
      },
    },
  },
};

function reply(text: string): FakeStep[] {
  const ask = text.toLowerCase();
  if (ask.includes('region')) {
    return [
      { type: 'say', text: 'Q3 against Q2, region by region:', chunk: 6 },
      { type: 'call', name: 'show', input: regions, ...STREAM },
      {
        type: 'say',
        text: 'EMEA grew fastest, by almost a fifth. The Americas are still the largest by a distance.',
        chunk: 6,
        delay: 12,
      },
    ];
  }
  if (ask.includes('week')) {
    return [
      { type: 'say', text: 'Week by week through the quarter:', chunk: 6 },
      { type: 'call', name: 'show', input: weekly, ...STREAM },
      {
        type: 'say',
        text: 'Signups dipped in week 8 and rose in each of the last two weeks.',
        chunk: 6,
        delay: 12,
      },
    ];
  }
  return [
    {
      type: 'say',
      text: 'Here is Q3 in one view: the headline numbers, then revenue month by month.',
      chunk: 6,
      delay: 12,
    },
    { type: 'call', name: 'show', input: quarter, ...STREAM },
    {
      type: 'say',
      text: 'Product carried the growth while services held steady. The buttons under the chart ask me for the next cut.',
      chunk: 6,
      delay: 12,
    },
  ];
}

if (process.argv[1]?.endsWith('charts.tsx')) {
  const root = await createRoot();
  root.render(<App />);
}

export { App, reply };
