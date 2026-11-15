import type { Channel, MacroPoint, MacroScene } from "@/shared/types";
import { clamp } from "@/shared/math";
import {
  MUTE_OFF,
  MUTE_ON,
  circularDistance,
  sampleAutomation,
  weights,
} from "../lib/morph";
export type MacroControl = { volume: boolean; mute: boolean };
export type MacroCompute = {
  channels: Record<
    string,
    { volume: number; muted: boolean; control: MacroControl } | undefined
  >;
  timbre: number;
  timbreControlled: boolean;
  referenced: Record<string, boolean>;
};
const MAX_POINTS = 4096;
const MIN_SPACING = 0.04; // beats between kept points
const REPLACE_RADIUS = 0.06; // stale points eaten as a new pass covers them
// Lane points carry a pass tag so an overdub pass replaces only older
// material; points written by the current pass are never eaten by their
// own successors.
type LanePoint = MacroPoint & { pass: number };
export function createMacros() {
  let slots: (MacroScene | null)[] = [null, null, null, null],
    position = { x: 0, y: 0 },
    dragging = false,
    automation: LanePoint[] = [],
    automationEnabled = true,
    recording = false,
    loopLength = 16,
    timbreManual = 0.5,
    autoReturn = false,
    pass = 0,
    lastInsert: number | null = null;
  const overrides = new Set<string>(),
    muteState = new Map<string, boolean>();
  let last: MacroCompute = {
      channels: {},
      timbre: timbreManual,
      timbreControlled: false,
      referenced: {},
    },
    lastPosition = { ...position };
  return {
    // --- pad position -----------------------------------------------------
    position: () => ({ ...position }),
    lastPosition: () => ({ ...lastPosition }),
    isDragging: () => dragging,
    setDragging(on: boolean) {
      dragging = on;
    },
    setPosition(x: number, y: number) {
      position = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    },
    // Where the morph should sit right now. Automation is sampled purely
    // from the current beat, so pause/resume continues from the lane value
    // instead of jumping back to wherever a previous drag left off.
    effectivePosition(running: boolean, paused: boolean, beat: number) {
      if (!dragging && automationEnabled && automation.length > 0 && (running || paused)) {
        const hit = sampleAutomation(automation, beat, loopLength);
        if (hit) return hit;
      }
      return position;
    },
    // --- slots ------------------------------------------------------------
    capture(slot: number, channels: Record<string, Channel>, timbre: number) {
      if (slot < 0 || slot > 3) return;
      slots[slot] = {
        volumes: Object.fromEntries(
          Object.entries(channels).map(([id, c]) => [id, c.volume]),
        ),
        mutes: Object.fromEntries(
          Object.entries(channels).map(([id, c]) => [id, c.muted]),
        ),
        timbre: clamp(timbre, 0, 1),
      };
    },
    clear(slot: number) {
      if (slot >= 0 && slot <= 3) slots[slot] = null;
    },
    slotInfo(trackIds: readonly string[]) {
      const alive = new Set(trackIds);
      return slots.map((scene) => {
        if (!scene) return { empty: true, broken: 0 };
        const refs = new Set([
          ...Object.keys(scene.volumes),
          ...Object.keys(scene.mutes),
        ]);
        let broken = 0;
        for (const id of refs) if (!alive.has(id)) broken++;
        return { empty: false, broken };
      });
    },
    // --- overrides (manual take-over) --------------------------------------
    detach(key: string) {
      overrides.add(key);
    },
    reattach(key: string) {
      overrides.delete(key);
    },
    reattachAll() {
      overrides.clear();
    },
    overrideList: () => [...overrides],
    autoReturn: () => autoReturn,
    setAutoReturn(on: boolean) {
      autoReturn = on;
    },
    // --- automation lane ----------------------------------------------------
    automation: () =>
      automation.map(({ beat, x, y }) => ({ beat, x, y })),
    automationCount: () => automation.length,
    automationEnabled: () => automationEnabled,
    setAutomationEnabled(on: boolean) {
      automationEnabled = on;
    },
    isRecording: () => recording,
    setRecording(on: boolean) {
      recording = on;
      if (on) {
        pass++;
        lastInsert = null;
      }
    },
    recordPoint(beat: number, x: number, y: number) {
      const at = ((beat % loopLength) + loopLength) % loopLength;
      if (lastInsert !== null) {
        if (at < lastInsert - loopLength / 2) pass++; // loop wrapped: new pass
        else if (circularDistance(at, lastInsert, loopLength) < MIN_SPACING)
          return;
      }
      automation = automation.filter(
        (p) =>
          p.pass === pass ||
          circularDistance(p.beat, at, loopLength) > REPLACE_RADIUS,
      );
      if (automation.length >= MAX_POINTS) return;
      automation.push({ beat: at, x: clamp(x, 0, 1), y: clamp(y, 0, 1), pass });
      automation.sort((a, b) => a.beat - b.beat);
      lastInsert = at;
    },
    clearAutomation() {
      automation = [];
      lastInsert = null;
    },
    setLoopLength(beats: number) {
      loopLength = beats;
      automation = automation.filter((p) => p.beat < beats);
      lastInsert = null;
    },
    // --- timbre -------------------------------------------------------------
    timbre: () => timbreManual,
    setTimbre(value: number) {
      timbreManual = clamp(value, 0, 1);
    },
    lastTimbre: () => last.timbre,
    // --- the morph itself ----------------------------------------------------
    // Stateful only in the per-track mute hysteresis; everything else is a
    // pure function of the pad position, so replays are deterministic.
    compute(trackIds: readonly string[], pos: { x: number; y: number }): MacroCompute {
      const w = weights(pos.x, pos.y);
      const result: MacroCompute = {
        channels: {},
        timbre: timbreManual,
        timbreControlled: false,
        referenced: {},
      };
      let timbreSum = 0,
        timbreWeight = 0;
      for (let i = 0; i < 4; i++) {
        const scene = slots[i];
        if (scene) {
          timbreSum += w[i] * scene.timbre;
          timbreWeight += w[i];
        }
      }
      for (const id of trackIds) {
        let weightSum = 0,
          volume = 0,
          muteAmount = 0;
        for (let i = 0; i < 4; i++) {
          const scene = slots[i];
          if (!scene) continue;
          const v = scene.volumes[id],
            m = scene.mutes[id];
          if (v === undefined && m === undefined) continue;
          weightSum += w[i];
          volume += w[i] * (v ?? 0.75);
          muteAmount += w[i] * (m ? 1 : 0);
        }
        result.referenced[id] = weightSum > 0;
        if (weightSum <= 0) {
          result.channels[id] = undefined;
          continue;
        }
        volume /= weightSum;
        muteAmount /= weightSum;
        const was = muteState.get(id) ?? false;
        let muted = was;
        if (!was && muteAmount >= MUTE_ON) muted = true;
        else if (was && muteAmount <= MUTE_OFF) muted = false;
        muteState.set(id, muted);
        result.channels[id] = {
          volume,
          muted,
          control: {
            volume: !overrides.has(`vol:${id}`),
            mute: !overrides.has(`mute:${id}`),
          },
        };
      }
      result.timbreControlled = timbreWeight > 0 && !overrides.has("timbre");
      result.timbre =
        timbreWeight > 0 && !overrides.has("timbre")
          ? timbreSum / timbreWeight
          : timbreManual;
      last = result;
      lastPosition = { ...pos };
      return result;
    },
    last: () => last,
    // Drop per-track runtime state for tracks that no longer exist; slot
    // scenes keep their (now broken) references on purpose.
    prune(trackIds: readonly string[]) {
      const alive = new Set(trackIds);
      for (const key of [...overrides]) {
        const id = key.split(":")[1];
        if (id && !alive.has(id)) overrides.delete(key);
      }
      for (const id of [...muteState.keys()])
        if (!alive.has(id)) muteState.delete(id);
    },
    // --- persistence ---------------------------------------------------------
    serialize() {
      return {
        macros: structuredClone(slots),
        automation: automation.map(({ beat, x, y }) => ({ beat, x, y })),
        timbre: timbreManual,
      };
    },
    restore(
      scenes: (MacroScene | null)[],
      lane: MacroPoint[],
      timbre: number,
      beats: number,
    ) {
      slots = [0, 1, 2, 3].map((i) =>
        scenes[i] ? structuredClone(scenes[i]) : null,
      );
      loopLength = beats;
      automation = structuredClone(lane)
        .filter((p) => p.beat < beats)
        .sort((a, b) => a.beat - b.beat)
        .map((p) => ({ ...p, pass: 0 }));
      pass = 0;
      lastInsert = null;
      timbreManual = clamp(timbre, 0, 1);
      automationEnabled = true;
      overrides.clear();
      muteState.clear();
      recording = false;
      dragging = false;
      position = { x: 0, y: 0 };
      lastPosition = { ...position };
      last = {
        channels: {},
        timbre: timbreManual,
        timbreControlled: false,
        referenced: {},
      };
    },
  };
}
export type Macros = ReturnType<typeof createMacros>;
