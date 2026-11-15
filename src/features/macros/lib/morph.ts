import { clamp, wrap } from "@/shared/math";
import type { MacroPoint } from "@/shared/types";
// Pad corners: A=(0,0) B=(1,0) C=(0,1) D=(1,1) → slots [A, B, C, D].
export const SLOT_NAMES = ["A", "B", "C", "D"] as const;
// Mute is a discrete intent, never a number to fade through: it flips only
// when the weighted mute amount crosses an explicit threshold, with a
// hysteresis band so hovering near the middle cannot flicker.
export const MUTE_ON = 0.6;
export const MUTE_OFF = 0.4;
export function weights(x: number, y: number): [number, number, number, number] {
  const u = clamp(x, 0, 1),
    v = clamp(y, 0, 1);
  return [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
}
// Distance on the loop circle, used to replace nearby points when overdubbing.
export function circularDistance(a: number, b: number, length: number) {
  const d = Math.abs(a - b);
  return Math.min(d, length - d);
}
// Stateless playback of the macro lane: the value at a beat depends only on
// the lane, so pausing or resuming can never resurrect a stale drag position.
export function sampleAutomation(
  points: readonly MacroPoint[],
  beat: number,
  length: number,
): { x: number; y: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  const at = wrap(beat, length);
  let prev = points[points.length - 1],
    next = points[0];
  for (const p of points) {
    if (p.beat <= at) prev = p;
    if (p.beat > at) {
      next = p;
      break;
    }
  }
  let from = prev.beat,
    to = next.beat,
    here = at;
  if (to <= from) to += length;
  if (here < from) here += length;
  const t = to > from ? clamp((here - from) / (to - from), 0, 1) : 0;
  return { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t };
}
