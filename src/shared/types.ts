export type Instrument = "drums" | "keys";
export type Note = {
  id: string;
  pitch: number;
  beat: number;
  duration: number;
  velocity: number;
};
export type Track = {
  id: string;
  name: string;
  instrument: Instrument;
  color: string;
  notes: Note[];
};
export type Channel = { volume: number; muted: boolean };
// A performance macro: one corner scene of the morph pad. Track references are
// stored by track id (never by name) so a deleted track leaves a broken
// reference instead of silently binding to a same-named new track.
export type MacroScene = {
  volumes: Record<string, number>;
  mutes: Record<string, boolean>;
  timbre: number;
};
// One sampled point of the independent macro performance lane, in loop beats.
export type MacroPoint = { beat: number; x: number; y: number };
export type Session = {
  version: 2;
  title: string;
  bpm: number;
  beats: number;
  tracks: Track[];
  channels: Record<string, Channel>;
  master: number;
  macros: (MacroScene | null)[];
  automation: MacroPoint[];
  timbre: number;
};
export type NoteInput = {
  pitch: number;
  velocity: number;
  instrument: Instrument;
};
export type ScheduledNote = NoteInput & {
  duration: number;
  when: number;
  trackId: string;
};
export type Listener = () => void;
