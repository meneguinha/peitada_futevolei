import React from 'react';
import { Dumbbell, Target, Sparkles, Check } from 'lucide-react';

export default function DrillRecommendations({ drills = [] }) {
  if (!drills || drills.length === 0) return null;

  return (
    <div className="space-y-4 pt-4 border-t border-slate-800">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Dumbbell className="w-5 h-5 text-emerald-400" />
          <span>Exercícios Educativos Recomendados (Treino de Correção):</span>
        </h3>
        <span className="badge badge-emerald">Treino Prático</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {drills.map((drill) => (
          <div key={drill.id} className="glass-card p-5 space-y-3 flex flex-col justify-between border-t-2 border-t-emerald-400">
            <div>
              <div className="flex items-center justify-between text-[11px] font-bold text-emerald-400 mb-1">
                <span>{drill.target}</span>
                <span className="text-slate-400 font-normal">{drill.difficulty}</span>
              </div>

              <h4 className="font-extrabold text-white text-base">
                {drill.title}
              </h4>

              <div className="my-3 space-y-1.5">
                {drill.instructions.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>

            {drill.videoTip && (
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 shrink-0 text-emerald-400" />
                <span><strong>Dica do Coach:</strong> {drill.videoTip}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
