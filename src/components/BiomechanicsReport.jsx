import React from 'react';
import { Award, AlertTriangle, CheckCircle2, RefreshCw, Eye, Dumbbell, Zap } from 'lucide-react';
import DrillRecommendations from './DrillRecommendations';
import { PERSPECTIVE_LABELS } from '../utils/angleDetector';

export default function BiomechanicsReport({
  report,
  currentPerspective,
  onChangePerspective,
  onReanalyze
}) {
  if (!report) return null;

  const {
    overallScore,
    flaws = [],
    strengths = [],
    phaseAnalysis = [],
    recommendedDrills = [],
    maxKneeBend,
    maxBackArch,
    maxForwardDrive
  } = report;

  const getScoreColor = (score) => {
    if (score >= 85) return 'from-emerald-400 to-cyan-500 text-emerald-400 border-emerald-500/30';
    if (score >= 70) return 'from-cyan-400 to-blue-500 text-cyan-400 border-cyan-500/30';
    return 'from-amber-400 to-rose-500 text-amber-400 border-amber-500/30';
  };

  const scoreBadgeStyle = getScoreColor(overallScore);

  return (
    <div className="space-y-6 my-8">
      {/* Overview Card */}
      <div className="glass-card p-6 md:p-8 relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          
          {/* Left: Big Score Gauge */}
          <div className="flex items-center gap-6">
            <div className="relative w-28 h-28 md:w-32 md:h-32 rounded-full border-4 border-slate-700/60 flex items-center justify-center bg-slate-900/60 shadow-xl shadow-cyan-500/10">
              <div className="text-center">
                <span className={`text-4xl md:text-5xl font-black bg-gradient-to-r ${scoreBadgeStyle} bg-clip-text text-transparent`}>
                  {overallScore}
                </span>
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Pontuação</span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-xl md:text-2xl font-extrabold text-white">
                  {overallScore >= 85 ? 'Técnica Excelente! 🚀' : overallScore >= 70 ? 'Boa Peitada (Com Ajustes) 🎯' : 'Precisa Corrigir a Biomecânica ⚠️'}
                </h3>
              </div>
              <p className="text-xs md:text-sm text-slate-300 max-w-md">
                {overallScore >= 85 
                  ? 'Você tem um excelente arquamento de tronco e boa impulsão de pernas.' 
                  : 'Identificamos pontos onde você está perdendo potência ou parábola no ataque de peito.'}
              </p>

              {/* Perspective Badge */}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-slate-400 font-medium">Ângulo Identificado:</span>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-cyan-300 font-semibold">
                  <Eye className="w-3.5 h-3.5" />
                  <span>{PERSPECTIVE_LABELS[currentPerspective]?.name || 'Diagonal 3/4'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Perspective Overrider */}
          <div className="glass-card p-3 border-slate-700/60 text-xs space-y-2 w-full md:w-auto">
            <span className="text-slate-400 font-semibold block">Ajustar Ângulo da Câmera:</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(PERSPECTIVE_LABELS).map((persp) => (
                <button
                  key={persp}
                  onClick={() => onChangePerspective(persp)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all text-[11px] ${
                    currentPerspective === persp
                      ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {PERSPECTIVE_LABELS[persp].icon} {persp === 'profile' ? 'Perfil' : persp === 'frontal' ? 'Frontal' : 'Diagonal 3/4'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Flaws Identified Section */}
      {flaws.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <span>O que você está fazendo de errado (Pontos de Correção):</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {flaws.map((flaw) => (
              <div 
                key={flaw.id}
                className="glass-card p-4 border-l-4 border-l-amber-400 bg-amber-500/5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-amber-300 text-sm md:text-base">
                    {flaw.title}
                  </h4>
                  <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                    {flaw.affectedPhase}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {flaw.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strengths Section */}
      {strengths.length > 0 && (
        <div className="glass-card p-4 border-l-4 border-l-emerald-400 bg-emerald-500/5">
          <h4 className="font-bold text-emerald-300 text-sm flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Pontos Fortes da Sua Técnica:</span>
          </h4>
          <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
            {strengths.map((str, idx) => (
              <li key={idx}>{str}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Phase Breakdown Grid */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-cyan-400" />
          <span>Análise Fase por Fase:</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {phaseAnalysis.map((item, idx) => (
            <div key={idx} className="glass-card p-4 space-y-2">
              <div className="text-xs font-bold text-cyan-400">
                {item.phase.name}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-extrabold text-white">{item.score}%</span>
                <span className="text-[11px] font-mono text-slate-400">{item.metric}</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    item.score >= 80 ? 'bg-emerald-400' : item.score >= 65 ? 'bg-cyan-400' : 'bg-amber-400'
                  }`}
                  style={{ width: `${item.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Corrective Drills Section */}
      <DrillRecommendations drills={recommendedDrills} />
    </div>
  );
}
