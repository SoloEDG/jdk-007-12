import type { Channel } from "@/shared/types";
import { level } from "../lib/levels";
import { createBuses } from "./buses";
export function createMixer() {
  let channels: Record<string, Channel> = {},
    master = 0.75;
  const buses = createBuses();
  const sync = (glide?: number) => buses.sync(channels, master, glide);
  return {
    snapshot() {
      return { channels: structuredClone(channels), master };
    },
    restore(next: Record<string, Channel>, volume: number) {
      channels = structuredClone(next);
      master = level(volume);
      sync();
    },
    ensure(ids: string[]) {
      channels = Object.fromEntries(
        ids.map((id) => [id, channels[id] ?? { volume: 0.75, muted: false }]),
      );
      sync();
    },
    volume(id: string, value: number) {
      if (channels[id])
        channels[id] = { ...channels[id], volume: level(value) };
      sync();
    },
    mute(id: string) {
      if (channels[id])
        channels[id] = { ...channels[id], muted: !channels[id].muted };
      sync(0.04);
    },
    // Macro-driven write: only the listed fields are touched, so parameters
    // the performer has taken over manually are left alone.
    setChannel(
      id: string,
      patch: { volume?: number; muted?: boolean },
      glide = 0.03,
    ) {
      const current = channels[id];
      if (!current) return;
      channels[id] = {
        volume: patch.volume === undefined ? current.volume : level(patch.volume),
        muted: patch.muted === undefined ? current.muted : patch.muted,
      };
      sync(glide);
    },
    master(value: number) {
      master = level(value);
      sync();
    },
    attach(ctx: AudioContext) {
      buses.attach(ctx);
      sync();
    },
    channel: (id: string) => buses.channel(id),
    dispose: () => buses.dispose(),
  };
}
export type Mixer = ReturnType<typeof createMixer>;
