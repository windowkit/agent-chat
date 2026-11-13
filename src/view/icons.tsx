// The chat's own glyphs, and the ghost icon button they sit in.
//
// react-x11's system set is affordances only — chevrons, a check, a plus —
// and says so: nouns belong to the app. Send, stop, copy, an image and a
// file are this chat's nouns, drawn here the way the set draws its own: a
// module-level `onDraw` over `<canvas mono>`, ink from the inherited
// `color`, geometry in fractions of the box, the stroke the set's weight.

import type { ReactElement } from 'react';
import {
  Button,
  Icon,
  Tooltip,
  iconNames,
  type IconName,
  type StyleProp,
} from 'react-x11';

type Draw = (ctx: any, info: { width: number; height: number }) => void;

const weight = (size: number) => Math.max(1.25, size / 12);

function line(
  ctx: any,
  w: number,
  h: number,
  points: readonly (readonly [number, number])[],
): void {
  ctx.lineWidth = weight(Math.min(w, h));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) =>
    i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h),
  );
  ctx.stroke();
}

function frame(
  ctx: any,
  w: number,
  h: number,
  [x0, y0, x1, y1]: readonly [number, number, number, number],
  radius: number,
  fill = false,
): void {
  ctx.lineWidth = weight(Math.min(w, h));
  ctx.beginPath();
  ctx.roundRect(
    x0 * w,
    y0 * h,
    (x1 - x0) * w,
    (y1 - y0) * h,
    radius * Math.min(w, h),
  );
  if (fill) ctx.fill();
  else ctx.stroke();
}

const GLYPHS = Object.freeze({
  // Return: what Enter does in the box, so the button says the key
  send: ((ctx, { width: w, height: h }) => {
    line(ctx, w, h, [
      [0.86, 0.14],
      [0.86, 0.62],
      [0.14, 0.62],
    ]);
    line(ctx, w, h, [
      [0.38, 0.38],
      [0.14, 0.62],
      [0.38, 0.86],
    ]);
  }) as Draw,
  stop: ((ctx, { width: w, height: h }) =>
    frame(ctx, w, h, [0.18, 0.18, 0.82, 0.82], 0.12, true)) as Draw,
  pause: ((ctx, { width: w, height: h }) => {
    line(ctx, w, h, [
      [0.32, 0.16],
      [0.32, 0.84],
    ]);
    line(ctx, w, h, [
      [0.68, 0.16],
      [0.68, 0.84],
    ]);
  }) as Draw,
  play: ((ctx, { width: w, height: h }) => {
    ctx.beginPath();
    ctx.moveTo(0.24 * w, 0.14 * h);
    ctx.lineTo(0.86 * w, 0.5 * h);
    ctx.lineTo(0.24 * w, 0.86 * h);
    ctx.closePath();
    ctx.fill();
  }) as Draw,
  // two sheets, the one behind showing at its top and left
  copy: ((ctx, { width: w, height: h }) => {
    frame(ctx, w, h, [0.34, 0.34, 0.92, 0.92], 0.12);
    line(ctx, w, h, [
      [0.66, 0.22],
      [0.66, 0.08],
      [0.08, 0.08],
      [0.08, 0.66],
      [0.22, 0.66],
    ]);
  }) as Draw,
  image: ((ctx, { width: w, height: h }) => {
    frame(ctx, w, h, [0.08, 0.14, 0.92, 0.86], 0.12);
    line(ctx, w, h, [
      [0.16, 0.78],
      [0.42, 0.5],
      [0.6, 0.66],
      [0.72, 0.56],
      [0.86, 0.72],
    ]);
    ctx.beginPath();
    ctx.arc(0.68 * w, 0.34 * h, 0.07 * Math.min(w, h), 0, Math.PI * 2);
    ctx.fill();
  }) as Draw,
  // a page with its corner turned
  file: ((ctx, { width: w, height: h }) =>
    line(ctx, w, h, [
      [0.58, 0.08],
      [0.18, 0.08],
      [0.18, 0.92],
      [0.82, 0.92],
      [0.82, 0.32],
      [0.58, 0.08],
      [0.58, 0.32],
      [0.82, 0.32],
    ])) as Draw,
});

export type GlyphName = keyof typeof GLYPHS;

/** A glyph of the chat's, or one of react-x11's system icons. */
export type ChatIcon = GlyphName | IconName;

export interface GlyphProps {
  name: ChatIcon;
  /** The mark's size. Default 14. */
  size?: number;
  /** Default: the ink around it. */
  color?: string;
  style?: StyleProp;
}

export function Glyph({
  name,
  size = 14,
  color,
  style,
}: GlyphProps): ReactElement {
  if ((iconNames as readonly string[]).includes(name)) {
    return (
      <Icon
        name={name as IconName}
        size={size}
        {...(color ? { color } : {})}
        {...(style ? { style } : {})}
      />
    );
  }
  return (
    <canvas
      mono
      cacheKey={`agent-chat:${name}`}
      onDraw={GLYPHS[name as GlyphName]}
      aria-hidden
      style={[
        { width: size, height: size, flexShrink: 0 },
        color ? { color } : null,
        style,
      ]}
    />
  );
}

export interface IconButtonProps {
  /** The button's name, read out and shown as its tooltip. */
  label: string;
  icon: ChatIcon;
  onPress?: () => void;
  disabled?: boolean;
  /** In the accent: the box's Send. */
  primary?: boolean;
  size?: number;
  'data-testname'?: string;
}

/** An icon button's side. */
export const ICON_BUTTON = 28;

/** A ghost button holding one glyph, named by its tooltip. */
export function IconButton({
  label,
  icon,
  onPress,
  disabled,
  primary,
  size = 14,
  'data-testname': testName,
}: IconButtonProps): ReactElement {
  return (
    <Tooltip label={label} delay={600}>
      <Button
        variant="ghost"
        size="small"
        aria-label={label}
        {...(primary ? { primary } : {})}
        {...(disabled ? { disabled } : {})}
        {...(onPress ? { onPress: () => onPress() } : {})}
        {...(testName ? { 'data-testname': testName } : {})}
        // square, the glyph centred: a ghost's hover is a tile, not a pill
        style={{
          width: ICON_BUTTON,
          height: ICON_BUTTON,
          paddingLeft: 0,
          paddingRight: 0,
          paddingTop: 0,
          paddingBottom: 0,
          borderRadius: 8,
        }}
      >
        <Glyph name={icon} size={size} />
      </Button>
    </Tooltip>
  );
}
