// The palette the chat draws with, read from the theme in force, so the chat
// takes the app's look and the desktop's light or dark scheme.

import { useMemo } from 'react';
import { useTheme } from 'react-x11';
import { tint } from 'react-x11/style';
import {
  codeBlockLook,
  type CodeBlockLook,
} from '@react-x11/components/codeblock';

export interface ChatLook {
  text: string;
  muted: string;
  border: string;
  surface: string;
  background: string;
  accent: string;
  danger: string;
  success: string;
  warning: string;
  mono: string;
  /** The user's bubble: the text colour, faintly, so it shows on any ground. */
  bubble: string;
}

export function useLook(): ChatLook {
  const theme = useTheme();
  return useMemo(() => {
    const text = String(theme.text ?? '#2d3436');
    return {
      text,
      muted: String(theme.textMuted ?? '#7f8c8d'),
      border: String(theme.border ?? '#b2bec3'),
      surface: String(theme.surface ?? '#f1f2f6'),
      background: String(theme.background ?? 'white'),
      accent: String(theme.accent ?? '#2980b9'),
      danger: String(theme.danger ?? '#c0392b'),
      success: String(theme.success ?? '#27ae60'),
      warning: String(theme.warning ?? '#e67e22'),
      mono: String(theme.monoFamily ?? 'monospace'),
      bubble: tint(text, 0.07),
    };
  }, [theme]);
}

/**
 * What a block of code looks like here: what `<Markdown>` draws a fence
 * with, at the chat's text size, so a fence the chat draws itself (to carry
 * its actions) has the fill, radius, inset and spacing of one it does not.
 */
export function useCodeLook(fontSize: number | undefined): CodeBlockLook {
  const theme = useTheme() as unknown as Record<string, unknown>;
  return useMemo(
    () => codeBlockLook(theme, fontSize ? { baseSize: fontSize } : {}),
    [theme, fontSize],
  );
}

/** At most `max` lines: the first and last halves, and how many were cut. */
export function clipLines(text: string, max = 200): string {
  const lines = text.split('\n');
  if (lines.length <= max) return text;
  const half = Math.floor(max / 2);
  return [
    ...lines.slice(0, half),
    `… ${lines.length - max} more lines …`,
    ...lines.slice(-half),
  ].join('\n');
}
