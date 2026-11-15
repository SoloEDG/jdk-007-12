import type { MacroPoint, MacroScene, Session, Track, Note } from "@/shared/types";
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x: unknown, min: number, max: number): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
function validateScene(raw: unknown): MacroScene | null {
  if (raw === null) return null;
  if (!object(raw) || !finite(raw.timbre, 0, 1)) throw new Error("宏数据无效");
  const scene: MacroScene = { volumes: {}, mutes: {}, timbre: raw.timbre };
  // References are keyed by track id and kept even when the track is gone:
  // the UI flags them as broken instead of retargeting a same-named track.
  if (!object(raw.volumes) || Object.keys(raw.volumes).length > 32)
    throw new Error("宏数据无效");
  for (const [id, v] of Object.entries(raw.volumes)) {
    if (!id || !finite(v, 0, 1)) throw new Error("宏数据无效");
    scene.volumes[id] = v;
  }
  if (!object(raw.mutes) || Object.keys(raw.mutes).length > 32)
    throw new Error("宏数据无效");
  for (const [id, m] of Object.entries(raw.mutes)) {
    if (!id || typeof m !== "boolean") throw new Error("宏数据无效");
    scene.mutes[id] = m;
  }
  return scene;
}
function validateAutomation(raw: unknown, beats: number): MacroPoint[] {
  if (!Array.isArray(raw) || raw.length > 4096) throw new Error("演出轨数据无效");
  const lane: MacroPoint[] = [];
  for (const p of raw) {
    if (
      !object(p) ||
      !finite(p.beat, 0, beats) ||
      !finite(p.x, 0, 1) ||
      !finite(p.y, 0, 1)
    )
      throw new Error("演出轨数据无效");
    lane.push({ beat: p.beat, x: p.x, y: p.y });
  }
  return lane.sort((a, b) => a.beat - b.beat);
}
export function validateSession(raw: unknown): Session {
  if (!object(raw) || (raw.version !== 1 && raw.version !== 2))
    throw new Error("存档格式或版本不受支持");
  if (
    typeof raw.title !== "string" ||
    raw.title.length > 80 ||
    !finite(raw.bpm, 40, 220) ||
    ![4, 8, 16, 32].includes(raw.beats as number) ||
    !Array.isArray(raw.tracks) ||
    raw.tracks.length > 8 ||
    !object(raw.channels) ||
    !finite(raw.master, 0, 1)
  )
    throw new Error("存档格式或版本不受支持");
  const beats = raw.beats as number;
  const ids = new Set<string>();
  const noteIds = new Set<string>();
  for (const value of raw.tracks) {
    if (!object(value)) throw new Error("轨道损坏");
    const t = value as unknown as Track;
    if (
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      !t.id ||
      typeof t.name !== "string" ||
      t.name.length > 32 ||
      !["drums", "keys"].includes(t.instrument) ||
      !/^#[0-9a-f]{6}$/i.test(t.color) ||
      !Array.isArray(t.notes) ||
      t.notes.length > 2048
    )
      throw new Error("轨道数据无效");
    ids.add(t.id);
    for (const n of t.notes as Note[]) {
      if (
        !object(n) ||
        typeof n.id !== "string" ||
        noteIds.has(n.id) ||
        !finite(
          n.pitch,
          t.instrument === "drums" ? 0 : 24,
          t.instrument === "drums" ? 3 : 108,
        ) ||
        !Number.isInteger(n.pitch) ||
        !finite(n.beat, 0, beats - 0.000001) ||
        !finite(n.duration, 0.01, beats) ||
        !finite(n.velocity, 0.01, 1)
      )
        throw new Error("音符数据无效");
      noteIds.add(n.id);
    }
    const c = (raw.channels as Record<string, unknown>)[t.id];
    if (!object(c) || !finite(c.volume, 0, 1) || typeof c.muted !== "boolean")
      throw new Error("混音数据无效");
  }
  const base = structuredClone(raw) as Record<string, unknown>;
  const macros =
    raw.version === 2
      ? (() => {
          const list: unknown = raw.macros;
          if (!Array.isArray(list) || list.length > 4)
            throw new Error("宏数据无效");
          return [0, 1, 2, 3].map((i) => validateScene(list[i] ?? null));
        })()
      : [null, null, null, null];
  const automation =
    raw.version === 2 ? validateAutomation(raw.automation ?? [], beats) : [];
  const timbre = raw.version === 2 ? raw.timbre : 0.5;
  if (!finite(timbre, 0, 1)) throw new Error("宏数据无效");
  return {
    ...(base as unknown as Omit<Session, "version" | "macros" | "automation" | "timbre">),
    version: 2,
    macros,
    automation,
    timbre,
  };
}
