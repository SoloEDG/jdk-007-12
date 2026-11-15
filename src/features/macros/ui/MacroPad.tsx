import { useRef } from "react";
import { SLOT_NAMES } from "../lib/morph";
import type { MacroControl } from "../model/macros";
export type MacroView = {
  slots: { empty: boolean; broken: number }[];
  position: { x: number; y: number };
  dragging: boolean;
  automation: { points: number; recording: boolean; enabled: boolean };
  timbre: number;
  timbreManual: number;
  timbreControlled: boolean;
  autoReturn: boolean;
  overrides: string[];
  control: Record<string, MacroControl | undefined>;
  referenced: Record<string, boolean>;
};
export function MacroPad({
  view,
  padDown,
  padMove,
  padUp,
  capture,
  clearSlot,
  toggleRecord,
  setAutomationEnabled,
  clearAutomation,
  timbre,
  timbreRelease,
  reattachAll,
  setAutoReturn,
}: {
  view: MacroView;
  padDown: (x: number, y: number) => void;
  padMove: (x: number, y: number) => void;
  padUp: () => void;
  capture: (slot: number) => void;
  clearSlot: (slot: number) => void;
  toggleRecord: () => void;
  setAutomationEnabled: (on: boolean) => void;
  clearAutomation: () => void;
  timbre: (n: number) => void;
  timbreRelease: () => void;
  reattachAll: () => void;
  setAutoReturn: (on: boolean) => void;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const locate = (e: React.PointerEvent) => {
    const box = pad.current?.getBoundingClientRect();
    if (!box || box.width === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: 1 - Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  };
  const allEmpty = view.slots.every((s) => s.empty);
  return (
    <section className="panel macro-panel">
      <div className="section-heading">
        <div>
          <small>04 / SCENES</small>
          <h2>
            演出宏<span>XY MORPH</span>
          </h2>
        </div>
        <span className="tag">{view.automation.recording ? "REC" : "MORPH"}</span>
      </div>
      <div className="macro-body">
        <div className="xy-zone">
          <div
            ref={pad}
            className={`xy-pad ${view.dragging ? "dragging" : ""}`}
            role="slider"
            aria-label="宏变形面板"
            aria-valuetext={`x ${Math.round(view.position.x * 100)}%, y ${Math.round(view.position.y * 100)}%`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = locate(e);
              padDown(p.x, p.y);
            }}
            onPointerMove={(e) => {
              if (!view.dragging) return;
              const p = locate(e);
              padMove(p.x, p.y);
            }}
            onPointerUp={padUp}
            onPointerCancel={padUp}
          >
            {SLOT_NAMES.map((name, i) => (
              <span
                key={name}
                className={`xy-corner c${i} ${view.slots[i]?.empty ? "" : "filled"}`}
              >
                {name}
              </span>
            ))}
            <i
              className="xy-handle"
              style={{
                left: `${view.position.x * 100}%`,
                top: `${(1 - view.position.y) * 100}%`,
              }}
            />
          </div>
          <small className="xy-hint">
            {allEmpty
              ? "先在混音台调好状态，再采集到四个角"
              : "拖动在四个宏之间连续变形"}
          </small>
        </div>
        <div className="macro-side">
          <div className="macro-slots">
            {SLOT_NAMES.map((name, i) => {
              const slot = view.slots[i] ?? { empty: true, broken: 0 };
              return (
                <div className="macro-slot" key={name}>
                  <button
                    className={slot.empty ? "" : "filled"}
                    onClick={() => capture(i)}
                    title={
                      slot.empty
                        ? "把当前混音与音色采集到这个角"
                        : "重新采集（覆盖当前宏）"
                    }
                  >
                    宏 {name}
                    {slot.empty ? " · 空" : " ●"}
                    {slot.broken > 0 && (
                      <em
                        className="broken-badge"
                        title="引用了已删除的轨道；这些引用已失效，不会套用到同名新轨"
                      >
                        ⚠ {slot.broken} 失效
                      </em>
                    )}
                  </button>
                  {!slot.empty && (
                    <button
                      className="slot-clear"
                      aria-label={`清空宏 ${name}`}
                      onClick={() => clearSlot(i)}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="timbre-row">
            <div className="timbre-head">
              <strong>琴键音色</strong>
              <span
                className={`macro-state ${view.timbreControlled ? "on" : "off"}`}
              >
                {view.timbreControlled ? "宏接管中" : "手动"}
              </span>
            </div>
            <input
              aria-label="琴键音色"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={view.timbre}
              onChange={(e) => timbre(Number(e.target.value))}
              onPointerUp={timbreRelease}
              onKeyUp={timbreRelease}
            />
            <small>柔和三角波 ↔ 明亮锯齿 · 按住的音符也会跟随变形</small>
          </div>
          <div className="automation-row">
            <button
              className={`record-dot ${view.automation.recording ? "on" : ""}`}
              onClick={toggleRecord}
              aria-pressed={view.automation.recording}
            >
              ● {view.automation.recording ? "记录演出中" : "记录演出"}
            </button>
            <button
              disabled={view.automation.points === 0}
              aria-pressed={view.automation.enabled}
              className={view.automation.enabled ? "lane-on" : ""}
              onClick={() => setAutomationEnabled(!view.automation.enabled)}
            >
              回放演出轨
            </button>
            <button
              disabled={view.automation.points === 0}
              onClick={clearAutomation}
            >
              清除
            </button>
            <small>
              {view.automation.points > 0
                ? `演出轨 · ${view.automation.points} 个采样点`
                : "演出轨为空 · 播放时拖动面板即可记录"}
            </small>
          </div>
          <div className="override-row">
            <label className="auto-return">
              <input
                type="checkbox"
                checked={view.autoReturn}
                onChange={(e) => setAutoReturn(e.target.checked)}
              />
              推子松手自动回归
            </label>
            {view.overrides.length > 0 ? (
              <>
                <span className="override-count">
                  {view.overrides.length} 项已脱离宏控
                </span>
                <button onClick={reattachAll}>全部回归</button>
              </>
            ) : (
              <span className="override-count ok">全部参数由宏接管</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
