import React from 'react';
import { PHASES } from '../utils/biomechanicsEngine';

export default function PhaseTimeline({
  currentFrame = 0,
  totalFrames = 30,
  onSeekFrame,
  impactFrameIndex = 15
}) {
  const phaseRanges = [
    { phase: PHASES.PREPARATION, start: 0, end: Math.floor(totalFrames * 0.3) },
    { phase: PHASES.ARCHING, start: Math.floor(totalFrames * 0.3), end: impactFrameIndex },
    { phase: PHASES.IMPACT, start: impactFrameIndex, end: Math.floor(totalFrames * 0.75) },
    { phase: PHASES.LANDING, start: Math.floor(totalFrames * 0.75), end: totalFrames - 1 }
  ];

  return (
    <div className="glass-card p-3 my-4">
      <div className="flex items-center justify-between text-xs text-slate-300 font-semibold mb-2">
        <span>Linha de Tempo Biomecânica</span>
        <span className="text-cyan-400 font-mono text-[11px]">Quadro {currentFrame + 1} / {totalFrames}</span>
      </div>

      {/* Phase Track Buttons */}
      <div className="grid grid-cols-4 gap-1.5 mb-2">
        {phaseRanges.map(({ phase, start, end }) => {
          const isActive = currentFrame >= start && currentFrame <= end;
          return (
            <button
              key={phase.id}
              onClick={() => onSeekFrame(start)}
              className={`p-2 rounded-lg text-left transition-all text-[11px] font-semibold border ${
                isActive 
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-sm shadow-cyan-500/20' 
                  : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <div className="truncate font-bold">{phase.name}</div>
              <div className="text-[9px] text-slate-400 font-normal hidden sm:block truncate">{phase.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Interactive Frame Slider */}
      <input
        type="range"
        min={0}
        max={totalFrames - 1}
        value={currentFrame}
        onChange={(e) => onSeekFrame(parseInt(e.target.value, 10))}
        className="w-full cursor-pointer accent-cyan-400"
      />
    </div>
  );
}
