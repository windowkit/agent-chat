// The files under the agent's working directory, for the composer's `@`
// list. A walk of the tree, kept for a few seconds so a burst of keystrokes
// reads it once, bounded so a home directory does not hang the list, and
// blind to what nobody mentions: dependencies, build output, VCS data.

import { readdir } from 'node:fs/promises';
import path from 'node:path';

const SKIPPED = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
]);

/** How many paths a walk collects before it stops. */
export const FILE_LIMIT = 5000;
const KEEP_MS = 10_000;

const walks = new Map<string, { at: number; files: Promise<string[]> }>();

/** Paths under `root`, relative and `/`-separated, files only. */
export function listFiles(root: string): Promise<string[]> {
  const kept = walks.get(root);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.files;
  const files = walk(root).catch(() => []);
  walks.set(root, { at: Date.now(), files });
  return files;
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  // breadth first, so the files nearest the root are the ones kept
  let level = [''];
  while (level.length && out.length < FILE_LIMIT) {
    const next: string[] = [];
    for (const dir of level) {
      let entries;
      try {
        entries = await readdir(path.join(root, dir), { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!SKIPPED.has(e.name)) next.push(rel);
        } else if (e.isFile()) {
          out.push(rel);
          if (out.length >= FILE_LIMIT) break;
        }
      }
      if (out.length >= FILE_LIMIT) break;
    }
    level = next;
  }
  return out;
}

/**
 * The paths a query names, best first: a file whose name starts with the
 * query, then one whose name holds it, then one whose path holds it, then
 * one whose path holds its characters in order. Case does not matter.
 */
export function matchFiles(
  files: readonly string[],
  query: string,
  max = 20,
): string[] {
  const q = query.toLowerCase();
  if (!q) return files.slice(0, max);
  const scored: Array<[number, string]> = [];
  for (const f of files) {
    const p = f.toLowerCase();
    const name = p.slice(p.lastIndexOf('/') + 1);
    const score = name.startsWith(q)
      ? 0
      : name.includes(q)
        ? 1
        : p.includes(q)
          ? 2
          : inOrder(p, q)
            ? 3
            : -1;
    if (score >= 0) scored.push([score * 10_000 + p.length, f]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, max).map(([, f]) => f);
}

function inOrder(text: string, query: string): boolean {
  let at = 0;
  for (const ch of query) {
    at = text.indexOf(ch, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}
