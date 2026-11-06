// The permission policy: what runs without asking, before the app's
// `onToolCall` has had a say. Pure, so the table below is the whole story.

import type { DriverConfig, GateDecision } from './driver.js';
import type { CoreToolKey, ToolCall, ToolKind } from './types.js';

/** The `coreTools` category a tool kind belongs to. */
export function categoryOf(kind: ToolKind): CoreToolKey | undefined {
  switch (kind) {
    case 'execute':
      return 'shell';
    case 'read':
    case 'search':
      return 'read';
    case 'edit':
    case 'delete':
    case 'move':
      return 'edit';
    case 'fetch':
      return 'web';
    default:
      return undefined;
  }
}

const READS: ReadonlySet<ToolKind> = new Set(['read', 'search', 'think']);
const EDITS: ReadonlySet<ToolKind> = new Set(['edit', 'move']);

/**
 * | policy        | reads | edits | anything else |
 * | ------------- | ----- | ----- | ------------- |
 * | `'ask'`       | run   | ask   | ask           |
 * | `'edits'`     | run   | run   | ask           |
 * | `'read-only'` | run   | deny  | deny          |
 * | `'auto'`      | the harness decides                 |
 *
 * Over all of it: an app tool runs unless its `ask` says otherwise, a
 * category or name in `coreTools` set to `'ask'` always asks, and one set to
 * `false` that a harness could not remove is denied.
 */
export function policyDecision(
  call: ToolCall,
  config: DriverConfig,
): GateDecision {
  const category = categoryOf(call.kind);
  const named = (list: readonly string[]) =>
    list.includes(call.label) ||
    (!call.app && !!category && list.includes(category));

  if (named(config.removed)) {
    return { behavior: 'deny', message: `${call.label} is turned off here.` };
  }
  if (call.app) {
    const tool = config.tools.get(call.label);
    return tool?.ask ? { behavior: 'ask' } : { behavior: 'allow' };
  }
  if (named(config.asking)) return { behavior: 'ask' };

  switch (config.permissions) {
    case 'auto':
      return { behavior: 'defer' };
    case 'read-only':
      return READS.has(call.kind)
        ? { behavior: 'allow' }
        : {
            behavior: 'deny',
            message: 'This session is read-only: nothing may be changed.',
          };
    case 'edits':
      return READS.has(call.kind) || EDITS.has(call.kind)
        ? { behavior: 'allow' }
        : { behavior: 'ask' };
    case 'ask':
    default:
      return READS.has(call.kind) ? { behavior: 'allow' } : { behavior: 'ask' };
  }
}
