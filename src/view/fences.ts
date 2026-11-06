// A reply split at its top-level fences, so each code block can carry a
// header of actions.
//
// `<Markdown>` draws a fence with no hook for a button on it, and adding one
// there (`codeActions`) is the right fix; until it lands, a reply is cut
// here. Only fences that start at the left margin are cut out: one indented
// under a list item stays in its list, drawn by `<Markdown>` without actions,
// rather than being pulled out of the list it belongs to.

export type Segment =
  | { type: 'prose'; text: string }
  | {
      type: 'fence';
      /** The info string's first word, lowercased: what renderers are keyed by. */
      lang: string;
      text: string;
      /** Still streaming: the fence has not closed and more may come. */
      partial: boolean;
    };

const OPEN = /^(`{3,}|~{3,})(.*)$/;

export function splitFences(source: string, streaming: boolean): Segment[] {
  const lines = source.split('\n');
  const out: Segment[] = [];
  let prose: string[] = [];
  let i = 0;
  const flush = () => {
    if (prose.length && prose.some((l) => l.trim())) {
      out.push({ type: 'prose', text: prose.join('\n') });
    }
    prose = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const open = OPEN.exec(line);
    // a backtick fence's info string may not hold a backtick
    if (!open || (open[1]![0] === '`' && open[2]!.includes('`'))) {
      prose.push(line);
      i++;
      continue;
    }
    const marker = open[1]!;
    const lang = (open[2]!.trim().split(/\s+/)[0] ?? '').toLowerCase();
    const body: string[] = [];
    let closed = false;
    i++;
    while (i < lines.length) {
      const l = lines[i]!;
      const close = /^(`{3,}|~{3,})\s*$/.exec(l);
      if (
        close &&
        close[1]![0] === marker[0] &&
        close[1]!.length >= marker.length
      ) {
        closed = true;
        i++;
        break;
      }
      body.push(l);
      i++;
    }
    flush();
    out.push({
      type: 'fence',
      lang,
      text: body.join('\n'),
      partial: !closed && streaming,
    });
  }
  flush();
  return out;
}
