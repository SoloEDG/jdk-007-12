import type { Session, Note } from "@/shared/types";
const note = (
  pitch: number,
  beat: number,
  duration = 0.18,
  velocity = 0.8,
): Note => ({ id: crypto.randomUUID(), pitch, beat, duration, velocity });
export function demoSession(): Session {
  return {
    version: 2,
    title: "凌晨两点 / After Hours",
    bpm: 108,
    beats: 16,
    master: 0.7,
    timbre: 0.3,
    macros: [
      {
        volumes: { rhythm: 0.8, chords: 0.55, lead: 0.55 },
        mutes: { rhythm: false, chords: false, lead: false },
        timbre: 0.3,
      },
      {
        volumes: { rhythm: 0.9, chords: 0.2, lead: 0.15 },
        mutes: { rhythm: false, chords: true, lead: true },
        timbre: 0.15,
      },
      {
        volumes: { rhythm: 0.25, chords: 0.7, lead: 0.5 },
        mutes: { rhythm: true, chords: false, lead: false },
        timbre: 0.55,
      },
      {
        volumes: { rhythm: 0.5, chords: 0.4, lead: 0.85 },
        mutes: { rhythm: false, chords: false, lead: false },
        timbre: 0.9,
      },
    ],
    automation: [
      { beat: 0, x: 0, y: 0 },
      { beat: 4, x: 1, y: 0 },
      { beat: 8, x: 1, y: 1 },
      { beat: 12, x: 0, y: 1 },
    ],
    channels: {
      rhythm: { volume: 0.8, muted: false },
      chords: { volume: 0.55, muted: false },
      lead: { volume: 0.55, muted: false },
    },
    tracks: [
      {
        id: "rhythm",
        name: "午夜鼓组",
        instrument: "drums",
        color: "#d5f377",
        notes: Array.from({ length: 16 }, (_, i) => [
          note(2, i, 0.12, 0.45),
          ...(i % 4 === 0 || i % 4 === 2 ? [note(0, i)] : []),
          ...(i % 4 === 1 || i % 4 === 3 ? [note(1, i, 0.2, 0.65)] : []),
        ]).flat(),
      },
      {
        id: "chords",
        name: "温暖和弦",
        instrument: "keys",
        color: "#bca5f4",
        notes: [0, 4, 8, 12].flatMap((b, i) =>
          [60, 64, 67].map((p) =>
            note(p + (i % 2 === 1 ? -3 : 0), b, 3.6, 0.4),
          ),
        ),
      },
      {
        id: "lead",
        name: "夜间旋律",
        instrument: "keys",
        color: "#8fbfff",
        notes: [72, 67, 69, 64, 67, 64, 62, 60].map((p, i) =>
          note(p, i * 2, 0.8, 0.55),
        ),
      },
    ],
  };
}
