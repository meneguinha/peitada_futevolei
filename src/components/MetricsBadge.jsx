import React from 'react';
import { Activity, Flame, RotateCcw, ShieldAlert } from 'lucide-react';

export default function MetricsBadge({
  avgKneeFlexion = 130,
  spineArchAngle = 145,
  bodyTilt = 10,
  perspective = 'profile'
}) {
  const getKneeStatus = (val) => {
    if (val <= 145 && val >= 105) return { text: 'Ideal (Mola OK)', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' };
    return { text: 'Pouca Flexão', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' };
  };

  const getArchStatus = (val) => {
    if (val <= 150) return { text: 'Ótimo Arquamento', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' };
    return { text: 'Coluna Rígida', color: 'text-rose-400 border-rose-500/30 bg-rose-500/10' };
  };

  const kneeStatus = getKneeStatus(avgKneeFlexion);
  const archStatus = getArchStatus(spineArchAngle);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
      {/* Metric 1: Knees */}
      <div className="glass-card p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>Flexão dos Joelhos</span>
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
        </div>
        <div className="my-1.5 flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold text-white">{Math.round(avgKneeFlexion)}°</span>
          <span className="text-[11px] text-slate-400">carr.</span>
        </div>
        <div className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${kneeStatus.color}`}>
          {kneeStatus.text}
        </div>
      </div>

      {/* Metric 2: Back Arch */}
      <div className="glass-card p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>Arquamento Tronco</span>
          <Flame className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <div className="my-1.5 flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold text-white">{Math.round(spineArchAngle)}°</span>
          <span className="text-[11px] text-slate-400">curva</span>
        </div>
        <div className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${archStatus.color}`}>
          {archStatus.text}
        </div>
      </div>

      {/* Metric 3: Hip Forward */}
      <div className="glass-card p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>Projeção de Quadril</span>
          <RotateCcw className="w-3.5 h-3.5 text-blue-400" />
        </div>
        <div className="my-1.5 flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold text-white">+{Math.max(0, Math.round(bodyTilt))}°</span>
          <span className="text-[11px] text-slate-400">avanço</span>
        </div>
        <div className="px-2 py-0.5 rounded-full border text-[10px] font-bold text-cyan-400 border-cyan-500/30 bg-cyan-500/10">
          Explosão OK
        </div>
      </div>

      {/* Metric 4: Camera View */}
      <div className="glass-card p-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span>Ângulo da Câmera</span>
          <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />
        </div>
        <div className="my-1.5 text-lg font-bold text-white capitalize truncate">
          {perspective === 'profile' ? 'Visão Perfil' : perspective === 'frontal' ? 'Visão Frontal' : 'Diagonal 3/4'}
        </div>
        <div className="px-2 py-0.5 rounded-full border text-[10px] font-bold text-purple-300 border-purple-500/30 bg-purple-500/10">
          3D Calibrado
        </div>
      </div>
    </div>
  );
}
