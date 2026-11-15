// The charts example's catalogue: what a generated UI may be made of, and
// how each piece is drawn.
//
// json-render (https://json-render.dev) keeps those two apart. The
// *catalog* is data: each component's props as a zod schema and a line for
// the model. It is all the model is told, and all a spec is checked against.
// The *registry* is code: the same names implemented with react-x11's
// `<box>` and `<text>` and the charts in `@react-x11/components/charts`.
// json-render calls nothing but `createElement`, so its `<Renderer>` drives
// react-x11's reconciler unchanged (sidorares/react-x11-components#127).
//
// The props are literal values: the data of a chart is in its spec. That
// suits a chat, where the numbers come from the conversation. json-render's
// state model (`$state`, `$bindState`, `repeat`) is left out of what the model
// is offered, so a spec is a picture of numbers it already has.

import type { ReactElement, ReactNode } from 'react';
import { z } from 'zod';
import { defineCatalog } from '@json-render/core';
import { defineRegistry } from '@json-render/react';
import { schema } from '@json-render/react/schema';
import { Button } from 'react-x11';
import {
  AreaChart,
  AreaSeries,
  BarChart,
  BarSeries,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  LineChart,
  LineSeries,
  XAxis,
  YAxis,
  type ChartConfig,
} from '@react-x11/components/charts';

// --- the catalogue ----------------------------------------------------------

const gap = z.number().optional().describe('Space between children, px');

// `x` and `series` come before `data` on purpose: the model writes members
// in the schema's order, so a chart's axes arrive first and its bars or
// points grow in as the rows stream.
const cartesian = z.object({
  title: z
    .string()
    .optional()
    .describe('What it plots, with units: "Cancellations, % of signups"'),
  x: z.string().describe('The key of each row that is its category: "month"'),
  series: z
    .array(
      z.object({
        key: z.string().describe('The key of each row holding this value'),
        label: z.string().optional(),
        color: z
          .string()
          .optional()
          .describe('A colour, "#0a7" or "$accent"; default: the palette'),
      }),
    )
    .describe('One per plotted value'),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .describe('The rows: { [x]: category, [series.key]: number, ... }'),
  stacked: z.boolean().optional(),
  height: z.number().optional().describe('px; default 180'),
});

export const catalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({ gap }),
      slots: ['default'],
      description: 'Lays its children out top to bottom.',
    },
    Row: {
      props: z.object({ gap }),
      slots: ['default'],
      description: 'Lays its children out left to right, sharing the width.',
    },
    Card: {
      props: z.object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
      }),
      slots: ['default'],
      description: 'A bordered panel with an optional title.',
    },
    Text: {
      props: z.object({
        text: z.string(),
        tone: z.enum(['default', 'muted', 'success', 'danger']).optional(),
        size: z.enum(['small', 'body', 'title']).optional(),
      }),
      description: 'A line or paragraph of plain text.',
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.string().describe('Formatted: "$1.2M", "38%"'),
        delta: z
          .string()
          .optional()
          .describe('Change, signed: "+8%", "-1.4 pts"'),
        trend: z
          .enum(['good', 'bad', 'neutral'])
          .optional()
          .describe(
            'Whether the change is good news, which colours it. Default: a rise is good. A falling cost or churn is "good".',
          ),
      }),
      description: 'A headline number with its caption. Put several in a Row.',
    },
    BarChart: {
      props: cartesian,
      description: 'Bars per category: compare amounts across categories.',
    },
    LineChart: {
      props: cartesian,
      description: 'Lines over an ordered x, such as time: show a trend.',
    },
    AreaChart: {
      props: cartesian,
      description:
        'Filled lines over an ordered x; stacked, the parts of a whole over time.',
    },
    Button: {
      props: z.object({
        label: z.string(),
        primary: z.boolean().optional(),
      }),
      description:
        'A button. Bind its "press" event to the "ask" action to offer a follow-up.',
    },
  },
  actions: {
    ask: {
      params: z.object({
        prompt: z.string().describe('Written as the user would ask it'),
      }),
      description:
        'Sends the prompt to the agent as the user’s next message: a drill-down or next step the user can take with one press.',
    },
  },
});

/** The events each component emits, which is where a spec may bind an
 *  action. json-render's catalogue has no field for it. */
export const events = { Button: ['press'] } as const;

// --- the registry -----------------------------------------------------------

type Cartesian = z.infer<typeof cartesian>;

const TONE = {
  default: '$text',
  muted: '$textMuted',
  success: '$success',
  danger: '$danger',
} as const;

const SIZE = { small: 11, body: 13, title: 16 } as const;

const TREND = {
  good: '$success',
  bad: '$danger',
  neutral: '$textMuted',
} as const;

export const { registry } = defineRegistry(catalog, {
  components: {
    Stack: ({ props, children }) => (
      <box style={{ flexDirection: 'column', gap: props.gap ?? 10 }}>
        {children}
      </box>
    ),

    Row: ({ props, children }) => (
      <box style={{ flexDirection: 'row', gap: props.gap ?? 12 }}>
        {children}
      </box>
    ),

    Card: ({ props, children }) => (
      <box
        style={{
          flexDirection: 'column',
          flexGrow: 1,
          flexBasis: 0,
          gap: 8,
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: '$border',
        }}
      >
        {props.title ? (
          <text style={{ fontSize: 13, color: '$text' }}>{props.title}</text>
        ) : null}
        {props.subtitle ? (
          <text style={{ fontSize: 11, color: '$textMuted' }}>
            {props.subtitle}
          </text>
        ) : null}
        {children}
      </box>
    ),

    Text: ({ props }) => (
      <text
        style={{
          fontSize: SIZE[props.size ?? 'body'],
          color: TONE[props.tone ?? 'default'],
        }}
      >
        {props.text}
      </text>
    ),

    Metric: ({ props }) => (
      <box
        style={{ flexDirection: 'column', gap: 2, flexGrow: 1, flexBasis: 0 }}
      >
        <text style={{ fontSize: 11, color: '$textMuted' }}>{props.label}</text>
        <text style={{ fontSize: 22, color: '$text' }}>{props.value}</text>
        {props.delta ? (
          <text
            style={{
              fontSize: 11,
              color:
                TREND[
                  props.trend ??
                    (props.delta.trim().startsWith('-') ? 'bad' : 'good')
                ],
            }}
          >
            {props.delta}
          </text>
        ) : null}
      </box>
    ),

    BarChart: ({ props }) => <Chart kind="bar" {...props} />,
    LineChart: ({ props }) => <Chart kind="line" {...props} />,
    AreaChart: ({ props }) => <Chart kind="area" {...props} />,

    // `emit('press')` is the whole of the binding: which action runs, and
    // with what, is in the spec's `on`, which the catalogue checked.
    Button: ({ props, emit }) => (
      <Button
        size="small"
        primary={props.primary ?? false}
        style={{ alignSelf: 'flex-start' }}
        onPress={() => emit('press')}
      >
        {props.label}
      </Button>
    ),
  },
  // `defineRegistry` wants every action implemented. `ask` needs the
  // session, so it is answered where the UI is drawn, from the tool's
  // `useActions`; these handlers are never handed to a provider.
  actions: { ask: async () => {} },
});

const PLOT = { bar: BarChart, line: LineChart, area: AreaChart } as const;

function Chart({
  kind,
  title,
  x,
  series,
  data,
  stacked,
  height,
}: Cartesian & { kind: keyof typeof PLOT }): ReactElement {
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [
      s.key,
      { label: s.label ?? s.key, ...(s.color ? { color: s.color } : {}) },
    ]),
  );
  const Plot = PLOT[kind];
  const stackId = stacked ? 'stack' : undefined;
  const chart = (
    <ChartContainer config={config} style={{ height: height ?? 180 }}>
      <Plot data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={x} />
        <YAxis width="auto" />
        <ChartTooltip />
        {series.length > 1 ? <ChartLegend /> : null}
        {series.map((s): ReactNode => {
          const common = { dataKey: s.key, stackId };
          if (kind === 'bar') {
            return <BarSeries key={s.key} {...common} radius={3} />;
          }
          if (kind === 'line') {
            return <LineSeries key={s.key} {...common} curve="monotone" />;
          }
          return (
            <AreaSeries
              key={s.key}
              {...common}
              curve="monotone"
              fillOpacity={0.3}
            />
          );
        })}
      </Plot>
    </ChartContainer>
  );
  if (!title) return chart;
  return (
    <box style={{ flexDirection: 'column', gap: 4 }}>
      <text style={{ fontSize: 12, color: '$textMuted' }}>{title}</text>
      {chart}
    </box>
  );
}
