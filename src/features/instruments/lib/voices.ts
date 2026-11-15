import type { ScheduledNote } from "@/shared/types";
export type Voice = {
  stop: () => void;
  end: number;
  setTimbre?: (value: number, when: number) => void;
};
// Keys timbre runs through live AudioParams (waveform blend + lowpass), so a
// morph reaches notes that are already sounding, not just the next attack.
const TIMBRE_SMOOTH = 0.035;
export function synthesize(
  ctx: AudioContext,
  output: AudioNode,
  note: ScheduledNote,
  timbre = 0.5,
): Voice {
  const when = Math.max(ctx.currentTime, note.when);
  const gain = ctx.createGain();
  gain.connect(output);
  const sources: AudioScheduledSourceNode[] = [];
  let length = note.duration;
  const amp = Math.max(0.001, note.velocity) * 0.35;
  let setTimbre: Voice["setTimbre"];
  if (note.instrument === "drums") {
    length = note.pitch === 0 ? 0.38 : note.pitch === 1 ? 0.22 : 0.12;
    if (note.pitch === 0) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(145, when);
      osc.frequency.exponentialRampToValueAtTime(42, when + 0.18);
      osc.connect(gain);
      sources.push(osc);
    } else {
      const buffer = ctx.createBuffer(
        1,
        Math.ceil(ctx.sampleRate * length),
        ctx.sampleRate,
      );
      const d = buffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = note.pitch === 1 ? 1000 : 6500;
      source.connect(filter);
      filter.connect(gain);
      sources.push(source);
    }
  } else {
    length = Math.max(0.08, note.duration);
    const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    filter.connect(gain);
    const tri = ctx.createOscillator();
    tri.type = "triangle";
    tri.frequency.value = frequency;
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.value = frequency;
    const triGain = ctx.createGain(),
      sawGain = ctx.createGain();
    tri.connect(triGain);
    triGain.connect(filter);
    saw.connect(sawGain);
    sawGain.connect(filter);
    sources.push(tri, saw);
    setTimbre = (value: number, at: number) => {
      const v = Math.min(1, Math.max(0, value));
      filter.frequency.setTargetAtTime(
        250 * 2 ** (v * 5),
        at,
        TIMBRE_SMOOTH,
      );
      triGain.gain.setTargetAtTime(Math.cos((v * Math.PI) / 2), at, TIMBRE_SMOOTH);
      sawGain.gain.setTargetAtTime(
        Math.sin((v * Math.PI) / 2) * 0.7,
        at,
        TIMBRE_SMOOTH,
      );
    };
    // Initial state is set directly so the attack starts on-timbre; later
    // morphs arrive as smoothed setTargetAtTime ramps.
    const v0 = Math.min(1, Math.max(0, timbre));
    filter.frequency.value = 250 * 2 ** (v0 * 5);
    triGain.gain.value = Math.cos((v0 * Math.PI) / 2);
    sawGain.gain.value = Math.sin((v0 * Math.PI) / 2) * 0.7;
  }
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(amp, when + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const s of sources) {
      try {
        s.stop();
      } catch {}
    }
    gain.disconnect();
  };
  let ended = 0;
  for (const source of sources) {
    source.onended = () => {
      ended++;
      if (ended === sources.length) {
        gain.disconnect();
        stopped = true;
      }
    };
    source.start(when);
    source.stop(when + length + 0.02);
  }
  return { stop, end: when + length + 0.02, setTimbre };
}
