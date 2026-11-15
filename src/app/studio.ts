import { createEngine, bindPerformanceInput } from "@/features/instruments";
import { createTransport, scheduleWindow } from "@/features/transport";
import { createRecorder } from "@/features/recorder";
import {
  createArrangement,
  demoSession,
  saveSession,
  loadSession,
} from "@/features/arrangement";
import { createMixer } from "@/features/mixer";
import { createMacros } from "@/features/macros";
import type { NoteInput, Instrument, Session } from "@/shared/types";
const SLOT_NAMES = "ABCD";
export function createStudio(notify: () => void) {
  const engine = createEngine(),
    transport = createTransport(),
    recorder = createRecorder(),
    arrangement = createArrangement(),
    mixer = createMixer(),
    macros = createMacros();
  const active = new Set<string>();
  let message = "欢迎来到夜航。戴上耳机，试着敲下第一拍。",
    epoch = 0,
    disposed = false;
  const now = () => engine.context?.currentTime ?? 0;
  const feedback = (text: string) => {
    message = text;
    notify();
  };
  const guard = (fn: () => void) => {
    try {
      fn();
      notify();
    } catch (error) {
      feedback(
        error instanceof Error ? error.message : "操作失败，现有作品已保留",
      );
    }
  };
  const syncMixer = () => mixer.ensure(arrangement.ids());
  const cancelVoices = () => {
    engine.cancel();
    active.clear();
  };
  // Push the morphed state into the same sound chain the performer hears:
  // mixer buses for volume/mute, live voices for timbre. Parameters the
  // performer has pulled out of macro control are skipped here.
  const applyMorph = (glide = 0.03) => {
    const t = transport.view(now());
    const pos = macros.effectivePosition(
      t.running,
      !t.running && t.absolute > 0,
      t.position,
    );
    const eff = macros.compute(arrangement.ids(), pos);
    for (const id of arrangement.ids()) {
      const c = eff.channels[id];
      if (!c) continue;
      const patch: { volume?: number; muted?: boolean } = {};
      if (c.control.volume) patch.volume = c.volume;
      if (c.control.mute) patch.muted = c.muted;
      if (patch.volume !== undefined || patch.muted !== undefined)
        mixer.setChannel(id, patch, glide);
    }
    engine.setTimbre(eff.timbre);
  };
  const recordMacroPoint = () => {
    const t = transport.view(now());
    if (!macros.isRecording() || !t.running) return;
    const p = macros.position();
    macros.recordPoint(t.position, p.x, p.y);
  };
  const stop = () => {
    epoch++;
    transport.stop();
    recorder.cancel();
    cancelVoices();
    notify();
  };
  const pause = () => {
    epoch++;
    transport.pause(now());
    recorder.cancel();
    cancelVoices();
    feedback("播放已暂停；未完成录音已取消，原片段保留。");
  };
  const unlock = async () => {
    const context = await engine.unlock();
    if (disposed) return false;
    mixer.attach(context);
    syncMixer();
    engine.route(mixer.channel);
    return true;
  };
  const play = async () => {
    const token = ++epoch;
    try {
      if (!(await unlock()) || token !== epoch) return;
      transport.start(now() + 0.02);
      tick();
      notify();
    } catch {
      feedback("声音启动失败，请再次点击播放");
    }
  };
  const tick = () => {
    applyMorph();
    const time = now(),
      view = transport.view(time);
    const take = recorder.advance(view.absolute);
    if (take)
      guard(() => {
        arrangement.commit(take.trackId, take.notes);
        message = `录制完成 · ${take.notes.length} 个音符`;
      });
    const capture = recorder.snapshot();
    const ceiling =
      capture.status === "idle" ? Infinity : capture.start + capture.length;
    const window = transport.window(time, ceiling);
    if (window)
      scheduleWindow(
        arrangement.forPlayback(),
        window.from,
        window.to,
        view.beats,
        view.bpm,
        window.timeAt,
        (n) => engine.play(n),
      );
  };
  const down = async (id: string, note: NoteInput) => {
    if (active.has(id)) return;
    active.add(id);
    notify();
    try {
      if (!(await unlock()) || !active.has(id)) return;
      const target = arrangement.selected();
      if (!target || target.instrument !== note.instrument) {
        active.delete(id);
        feedback("请先选择对应乐器的轨道");
        return;
      }
      const abs = transport.view(now()).absolute;
      const take = recorder.advance(abs);
      if (take) arrangement.commit(take.trackId, take.notes);
      recorder.down(id, note, abs);
      engine.play(
        {
          ...note,
          trackId: target.id,
          duration: note.instrument === "keys" ? 6 : 0.3,
          when: now(),
        },
        id,
      );
    } catch {
      active.delete(id);
      feedback("请点击播放以启用声音");
    }
  };
  const up = (id: string) => {
    if (!active.delete(id)) return;
    recorder.up(id, transport.view(now()).absolute);
    engine.release(id);
    notify();
  };
  const install = (session: Session) => {
    stop();
    const valid = arrangement.restore(session);
    transport.configure(valid.bpm, valid.beats);
    mixer.restore(valid.channels, valid.master);
    macros.restore(valid.macros, valid.automation, valid.timbre, valid.beats);
    applyMorph(0.01);
    notify();
  };
  const timer = window.setInterval(() => {
    tick();
    notify();
  }, 20);
  const unbind = bindPerformanceInput((id, note) => void down(id, note), up);
  const shortcut = (e: KeyboardEvent) => {
    if (
      e.code === "Space" &&
      !e.repeat &&
      !/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target as HTMLElement).tagName)
    ) {
      e.preventDefault();
      if (transport.view(now()).running) pause();
      else void play();
    }
  };
  const blur = () => {
    for (const id of [...active]) up(id);
  };
  window.addEventListener("keydown", shortcut);
  window.addEventListener("blur", blur);
  return {
    view() {
      const a = arrangement.snapshot(),
        ids = a.tracks.map((t) => t.id),
        morph = macros.last();
      return {
        transport: transport.view(now()),
        arrangement: a,
        selected: arrangement.selected(),
        recorder: recorder.snapshot(),
        mixer: mixer.snapshot(),
        active: new Set(active),
        message,
        macros: {
          slots: macros.slotInfo(ids),
          position: macros.lastPosition(),
          dragging: macros.isDragging(),
          automation: {
            points: macros.automationCount(),
            recording: macros.isRecording(),
            enabled: macros.automationEnabled(),
          },
          timbre: morph.timbre,
          timbreManual: macros.timbre(),
          timbreControlled: morph.timbreControlled,
          autoReturn: macros.autoReturn(),
          overrides: macros.overrideList(),
          control: Object.fromEntries(
            ids.map((id) => [id, morph.channels[id]?.control]),
          ),
          referenced: { ...morph.referenced },
        },
      };
    },
    play,
    pause,
    stop,
    down: (id: string, n: NoteInput) => void down(id, n),
    up,
    configure(bpm: number, beats: number) {
      stop();
      transport.configure(bpm, beats);
      arrangement.resizeLoop(transport.view(now()).beats);
      macros.setLoopLength(transport.view(now()).beats);
      feedback("速度或长度变更：播放回到起点；缩短时移除范围外音符。");
    },
    add(kind: Instrument) {
      guard(() => {
        arrangement.add(kind);
        syncMixer();
      });
    },
    select(id: string) {
      if (recorder.snapshot().status !== "idle") return;
      engine.releaseHeld();
      active.clear();
      arrangement.select(id);
      notify();
    },
    remove() {
      guard(() => {
        const selected = arrangement.selected();
        if (selected) {
          stop();
          arrangement.remove(selected.id);
          syncMixer();
          macros.prune(arrangement.ids());
        }
      });
    },
    clear() {
      guard(() => {
        const t = arrangement.selected();
        if (t) {
          stop();
          arrangement.clear(t.id);
        }
      });
    },
    async record() {
      const selected = arrangement.selected();
      if (!selected) return;
      const token = ++epoch;
      try {
        if (!(await unlock()) || token !== epoch) return;
        const state = transport.view(now());
        if (!state.running) transport.start(now() + 0.02);
        recorder.arm(
          selected.id,
          selected.instrument,
          transport.view(now()).absolute,
          state.beats,
        );
        tick();
        notify();
      } catch {
        feedback("录音启动失败，请重试");
      }
    },
    cancel() {
      recorder.cancel();
      feedback("本次录音已取消，之前的片段仍然保留。");
    },
    grid(n: number) {
      recorder.grid(n);
      notify();
    },
    volume(id: string, n: number) {
      macros.detach(`vol:${id}`);
      mixer.volume(id, n);
      notify();
    },
    mute(id: string) {
      macros.detach(`mute:${id}`);
      mixer.mute(id);
      notify();
    },
    faderRelease(id: string) {
      if (!macros.autoReturn()) return;
      macros.reattach(`vol:${id}`);
      applyMorph(0.08);
      notify();
    },
    reattachTrack(id: string) {
      macros.reattach(`vol:${id}`);
      macros.reattach(`mute:${id}`);
      applyMorph(0.08);
      feedback("该轨道已回归宏控。");
    },
    master(n: number) {
      mixer.master(n);
      notify();
    },
    // --- performance macros -------------------------------------------------
    padDown(x: number, y: number) {
      macros.setDragging(true);
      macros.setPosition(x, y);
      recordMacroPoint();
      applyMorph(0.02);
      notify();
    },
    padMove(x: number, y: number) {
      macros.setPosition(x, y);
      recordMacroPoint();
      applyMorph(0.02);
    },
    padUp() {
      macros.setDragging(false);
      // If the automation lane is driving, glide back to its value at the
      // current beat instead of staying on the drag's exit position.
      applyMorph(0.08);
      notify();
    },
    captureMacro(slot: number) {
      guard(() => {
        macros.capture(slot, mixer.snapshot().channels, macros.lastTimbre());
        message = `宏 ${SLOT_NAMES[slot]} 已采集 · 当前各轨音量 / 静音与琴键音色`;
      });
    },
    clearMacro(slot: number) {
      guard(() => {
        macros.clear(slot);
        message = `宏 ${SLOT_NAMES[slot]} 已清空`;
      });
    },
    toggleMacroRecord() {
      const on = !macros.isRecording();
      macros.setRecording(on);
      feedback(
        on
          ? "演出记录中 · 播放时拖动变形面板，轨迹会写进独立演出轨"
          : `演出轨已记录 ${macros.automationCount()} 个采样点`,
      );
    },
    setAutomationEnabled(on: boolean) {
      macros.setAutomationEnabled(on);
      applyMorph(0.08);
      feedback(on ? "演出轨回放已开启" : "演出轨回放已关闭，面板完全手动");
    },
    clearAutomation() {
      guard(() => {
        macros.clearAutomation();
        message = "演出轨已清空，演奏音符不受影响";
      });
    },
    timbre(n: number) {
      macros.detach("timbre");
      macros.setTimbre(n);
      engine.setTimbre(n);
      notify();
    },
    timbreRelease() {
      if (!macros.autoReturn()) return;
      macros.reattach("timbre");
      applyMorph(0.08);
      notify();
    },
    reattachAll() {
      macros.reattachAll();
      applyMorph(0.08);
      feedback("全部参数已回归宏控。");
    },
    setAutoReturn(on: boolean) {
      macros.setAutoReturn(on);
      notify();
    },
    demo() {
      guard(() => {
        install(demoSession());
        message = "示范已载入 · 点击播放，听听凌晨两点。";
      });
    },
    save() {
      guard(() => {
        if (recorder.snapshot().status !== "idle")
          throw new Error("请完成或取消录音后再保存");
        const a = arrangement.snapshot(),
          t = transport.view(now()),
          m = mixer.snapshot(),
          macroState = macros.serialize();
        saveSession({
          version: 2,
          title: a.title,
          bpm: t.bpm,
          beats: t.beats,
          tracks: a.tracks,
          channels: m.channels,
          master: m.master,
          macros: macroState.macros,
          automation: macroState.automation,
          timbre: macroState.timbre,
        });
        message = "作品已保存到本机浏览器";
      });
    },
    load() {
      guard(() => {
        const session = loadSession();
        install(session);
        message = "本地作品已恢复";
      });
    },
    dispose() {
      disposed = true;
      epoch++;
      clearInterval(timer);
      unbind();
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("blur", blur);
      mixer.dispose();
      engine.dispose();
    },
  };
}
export type Studio = ReturnType<typeof createStudio>;
