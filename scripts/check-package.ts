// What would be published, checked where the compiler has no opinion:
//
// 1. every `exports` entry points at a file the build wrote;
// 2. no emitted declaration names a Node type or the rich text editor's
//    ProseMirror types, so an app type-checks against this package without
//    `@types/node` or DOM globals;
// 3. `./core`, `./drivers/*` and `./testing` import no React and no renderer:
//    a DOM or terminal front end can use them;
// 4. the package resolves by its own name, the way an installed copy does.
//
//   npm run build && npm run check:package

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
) as {
  name: string;
  exports: Record<string, string | { types: string; default: string }>;
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const problems: string[] = [];

for (const [subpath, target] of Object.entries(pkg.exports)) {
  const files =
    typeof target === 'string' ? [target] : [target.types, target.default];
  for (const f of files) {
    if (!existsSync(path.join(root, f)))
      problems.push(`${subpath}: ${f} was not built`);
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const dist = path.join(root, 'dist');
const LEAKS = [
  /\bBuffer\b/,
  /\bNodeJS\./,
  /from ['"]node:/,
  /prosemirror/,
  /rich-text-editor/,
];
for (const file of walk(dist).filter((f) => f.endsWith('.d.ts'))) {
  const text = readFileSync(file, 'utf8');
  for (const leak of LEAKS) {
    if (leak.test(text))
      problems.push(`${path.relative(root, file)} names ${leak}`);
  }
}

const RENDERER = /from ['"](react|react-x11|@react-x11\/[^'"]+)(\/[^'"]*)?['"]/;
for (const dir of ['core', 'drivers', 'testing']) {
  for (const file of walk(path.join(dist, dir)).filter((f) =>
    f.endsWith('.js'),
  )) {
    if (RENDERER.test(readFileSync(file, 'utf8'))) {
      problems.push(`${path.relative(root, file)} imports React or a renderer`);
    }
  }
}

for (const name of ['react-x11', '@react-x11/components', 'react']) {
  if (!pkg.peerDependencies[name])
    problems.push(`${name} must be a peer dependency`);
}

const self = await import(pkg.name).catch((err: unknown) => {
  problems.push(`${pkg.name} does not resolve by name: ${String(err)}`);
  return null;
});
if (self && typeof self.AgentChat !== 'function') {
  problems.push(`${pkg.name} does not export AgentChat`);
}

if (problems.length) {
  console.error(problems.map((p) => `✖ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✔ ${pkg.name}: exports, declarations and layering check out`);
