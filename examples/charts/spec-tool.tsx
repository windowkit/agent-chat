// A json-render catalogue as one of the chat's tools: the model draws a UI by
// calling the tool, and the chat draws the call as that UI.
//
// json-render's own prompt has the model write the spec into its reply, as
// JSON patches in a ```spec fence. Here it goes in a tool call instead:
//
// - **It is checked before it counts.** The tool's parameters are the
//   catalogue: a union of the components, each with its own props schema.
//   The model is shown exactly what each one takes. A spec that does not fit
//   (an unknown component, a missing prop, a child that is not there)
//   becomes a tool error the model reads and corrects. A fence that is wrong
//   just gets drawn wrong.
// - **It is plain data in the transcript.** The spec is the tool part's
//   input, so a recorded session replays it and a test can compare it.
// - **It still streams.** The model writes a tool's arguments as it writes
//   prose (`input_json_delta`), and `render` gets them as they arrive
//   (`streaming: true`). Elements are drawn as soon as their props are
//   whole.
//
// The cost is one round trip. The model reads the tool's result and carries
// on, where a fence would let it carry on without stopping.
//
// Nothing here is specific to charts. The app hands over a catalogue, its
// registry and its action handlers; see `charts.tsx`.

import { useMemo, type ReactElement } from 'react';
import { z } from 'zod';
import {
  createStateStore,
  formatSpecIssues,
  validateSpec,
  type ActionHandler,
  type Spec,
  type UIElement,
} from '@json-render/core';
import {
  ActionProvider,
  Renderer,
  StateProvider,
  ValidationProvider,
  VisibilityProvider,
  type ComponentRegistry,
} from '@json-render/react';

import { defineTool } from '../../src/index.js';

/** The part of a json-render catalogue this reads: `defineCatalog`'s
 *  `data`. */
export interface CatalogLike {
  data: {
    components: Record<
      string,
      { props: z.ZodType; slots?: readonly string[]; description?: string }
    >;
    actions?: Record<string, { params?: z.ZodType; description?: string }>;
  };
}

export interface SpecToolOptions {
  catalog: CatalogLike;
  registry: ComponentRegistry;
  /** When to draw rather than write, in the app's words. It comes before
   *  the description of what a spec is. */
  description: string;
  /** The events each component emits, by component: where the model may
   *  bind an action. */
  events?: Readonly<Record<string, readonly string[]>>;
  /** A hook, called where the UI is drawn, that answers the catalogue's
   *  actions. It is a hook so a handler can reach the app's session. */
  useActions?: () => Readonly<Record<string, ActionHandler>>;
}

const HOW =
  'A UI is a flat map of elements. `root` is the key of the outermost ' +
  'element; an element names the elements inside it by key in ' +
  '`children`. Use only the components below, with the props each one ' +
  'takes. Write `root` first and each parent before its children: the ' +
  'user watches the UI being built as you write it. Write prose around ' +
  'the call as usual; the UI appears where you make it.';

export function specTool(options: SpecToolOptions) {
  const { catalog, registry } = options;
  const useActions = options.useActions ?? noActions;
  const parameters = specParameters(catalog, options.events ?? {});

  function SpecView({
    input,
    streaming,
  }: {
    input: unknown;
    streaming: boolean;
  }): ReactElement | null {
    const handlers = useActions();
    // the catalogue's props are literal, so the state model starts and
    // stays empty; the providers are what `<Renderer>` reads
    const store = useMemo(() => createStateStore({}), []);
    const spec = useMemo(
      () => drawable(input, catalog, streaming),
      [input, streaming],
    );
    if (!spec) return null;
    return (
      <StateProvider store={store}>
        <VisibilityProvider>
          <ValidationProvider>
            <ActionProvider handlers={{ ...handlers }}>
              <Renderer spec={spec} registry={registry} loading={streaming} />
            </ActionProvider>
          </ValidationProvider>
        </VisibilityProvider>
      </StateProvider>
    );
  }

  return defineTool({
    description: `${options.description}\n\n${HOW}`,
    parameters,
    card: false,
    title: () => 'Show a UI',
    run: (spec) => {
      const { issues } = validateSpec(spec as Spec);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) {
        throw new Error(`Not shown: ${formatSpecIssues(errors)}`);
      }
      const n = Object.keys(spec.elements).length;
      return (
        `Shown to the user (${n} elements). They are looking at it: ` +
        'refer to it, but do not repeat its numbers.'
      );
    },
    render: ({ input, streaming }) => (
      <SpecView input={input} streaming={streaming} />
    ),
  });
}

function noActions(): Readonly<Record<string, ActionHandler>> {
  return {};
}

/**
 * The tool's parameters: `{ root, elements }`, each element one of the
 * catalogue's components with that component's own props, so the JSON
 * Schema the model is sent says exactly what each takes.
 */
export function specParameters(
  catalog: CatalogLike,
  events: Readonly<Record<string, readonly string[]>>,
) {
  const actions = Object.entries(catalog.data.actions ?? {}).map(
    ([name, def]) =>
      z
        .object({
          action: z.literal(name),
          ...(def.params ? { params: def.params } : {}),
        })
        .describe(def.description ?? name),
  );
  const binding = actions.length > 1 ? z.union(tuple(actions)) : actions[0];

  const components = Object.entries(catalog.data.components).map(
    ([type, def]) => {
      const emits = events[type] ?? [];
      return z
        .object({
          type: z.literal(type),
          props: def.props,
          ...(def.slots?.length
            ? {
                children: z
                  .array(z.string())
                  .optional()
                  .describe('The keys of the elements inside, in order'),
              }
            : {}),
          ...(binding && emits.length
            ? {
                on: z
                  .object(
                    Object.fromEntries(
                      emits.map((e) => [e, binding.optional()]),
                    ),
                  )
                  .optional()
                  .describe('The action each event runs'),
              }
            : {}),
        })
        .describe(def.description ?? type);
    },
  );
  if (components.length < 2) {
    throw new Error('specTool: a catalogue of at least two components');
  }

  return z.object({
    root: z.string().describe('The key of the outermost element'),
    elements: z
      .record(z.string(), z.discriminatedUnion('type', tuple(components)))
      .describe(
        'Every element, by a short key of your own: "summary", "revenue-chart"',
      ),
  });
}

function tuple<T>(items: T[]): [T, T, ...T[]] {
  return items as [T, T, ...T[]];
}

/**
 * What can be drawn of the arguments: every element whose type is in the
 * catalogue and whose props are whole. While the arguments stream in, that
 * leaves out the element being written until its props are complete enough
 * to draw (a string still growing is fine). It also takes away events until
 * the spec is complete, since a half-written binding would run the wrong
 * action. `null` until the root can be drawn.
 */
function drawable(
  input: unknown,
  catalog: CatalogLike,
  streaming: boolean,
): Spec | null {
  if (!input || typeof input !== 'object') return null;
  const { root, elements } = input as { root?: unknown; elements?: unknown };
  if (typeof root !== 'string' || !elements || typeof elements !== 'object') {
    return null;
  }
  const out: Record<string, UIElement> = {};
  for (const [key, value] of Object.entries(elements)) {
    const el = value as Partial<UIElement> | null;
    const def = el && catalog.data.components[String(el.type)];
    if (!def || !def.props.safeParse(el.props ?? {}).success) continue;
    out[key] = {
      type: String(el.type),
      props: el.props as Record<string, unknown>,
      children: Array.isArray(el.children)
        ? el.children.filter((c): c is string => typeof c === 'string')
        : [],
      ...(!streaming && el.on ? { on: el.on } : {}),
    };
  }
  return root in out ? { root, elements: out } : null;
}
