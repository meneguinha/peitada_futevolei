import React from 'react';
import { FIGURE, ILLUSTRATED_KNEE_ANGLE, ILLUSTRATED_TORSO_TILT } from '../utils/figureGeometry';

/**
 * Explains, on the landing screen, what the analysis actually measures.
 *
 * The stick figure is not a sketch: the joint positions were solved so that the
 * drawn knee angle is exactly 135 degrees and the drawn torso tilt exactly 30 —
 * the middle of each ideal band quoted in the legend. A diagram teaching angle
 * measurement should be measurable itself.
 *
 * Colour follows the brand rule that coral marks impact and contact only; the
 * measurement annotations stay in the technical blues and greens.
 *
 * Ranges and weights below mirror scorePeitada() in utils/peitadaDetector.js.
 * If those thresholds change, change them here too.
 */

const METRICS = [
  {
    color: 'var(--primary)',
    textColor: 'var(--primary)',
    label: 'Arco do tronco',
    ideal: '23° a 40°',
    weight: '35% (26% c/ bola)',
    text: 'Ângulo entre o tronco (quadril → ombros) e a vertical. Inclinação dorsal e projeção peitoral para direcionar a bola para cima.'
  },
  {
    color: 'var(--secondary)',
    textColor: 'var(--secondary-text)',
    label: 'Flexão do joelho',
    ideal: '120° a 150°',
    weight: '30% (22% c/ bola)',
    text: 'Ângulo no joelho entre a coxa e a canela. Atua como mola na areia para amortecer a descida e dar impulsão no contato.'
  },
  {
    color: 'var(--warning)',
    textColor: 'var(--warning-text)',
    label: 'Avanço do quadril',
    ideal: '~14 a 26 cm (0.08h a 0.16h)',
    weight: '20% (12% c/ bola)',
    text: 'Projeção pélvica para frente no momento do impacto para gerar potência e altura na subida da bola.'
  },
  {
    color: 'var(--success)',
    textColor: 'var(--success-text)',
    label: 'Simetria dos braços',
    ideal: 'diferença < 15°',
    weight: '15% (10% c/ bola)',
    text: 'Abertura simultânea e simétrica dos braços para estabilização postural no ar e equilíbrio do tronco.'
  }
];

// `color` marks the dot (a fill, 3:1 is enough); `textColor` is the darkened
// variant used for the range, which has to clear 4.5:1 as text.
function Metric({ color, textColor, label, ideal, weight, text }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: color,
        marginTop: 7, flexShrink: 0
      }} />
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span className="font-semibold" style={{ fontSize: 14 }}>{label}</span>
          <span className="num" style={{ fontSize: 13, color: textColor }}>{ideal}</span>
          <span className="text-xs text-faint">peso {weight}</span>
        </div>
        <p className="text-sm text-muted" style={{ margin: '2px 0 0' }}>{text}</p>
      </div>
    </div>
  );
}

export default function HowItWorks() {
  return (
    <div className="card p-6" style={{ marginTop: 28 }}>
      <h3>Como os ângulos são medidos</h3>
      <p className="text-muted" style={{ margin: '8px 0 24px', maxWidth: 640 }}>
        A IA marca 33 pontos do seu corpo em cada quadro e mede tudo no{' '}
        <strong style={{ color: 'var(--text)' }}>instante de maior arqueamento</strong> — o pico do
        movimento. As medidas são feitas em coordenadas 3D em metros, não em pixels, para que o
        formato do vídeo não distorça os ângulos.
      </p>

      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        <svg viewBox="60 0 300 300" style={{ width: 288, height: 288, flexShrink: 0 }} role="img"
             aria-label="Boneco em posição de peitada com o ângulo do tronco de 30 graus e o do joelho de 135 graus">
          <line x1="90" y1="272" x2="330" y2="272" stroke="var(--border-strong)" strokeWidth="2" />

          {/* vertical reference through the hip */}
          <line x1="214" y1="128" x2="214" y2="40" stroke="var(--text-faint)"
                strokeWidth="1.5" strokeDasharray="4 4" />
          <text x="219" y="46" fill="var(--text-faint)" fontSize="11" fontFamily="var(--font-mono)">vertical</text>

          {/* torso arch angle: 30 degrees, measured from vertical */}
          <path d="M 214 70 A 58 58 0 0 0 185 77.8" fill="none" stroke="var(--primary)" strokeWidth="2" />
          <text x="146" y="66" fill="var(--primary)" fontSize="15" fontWeight="700" fontFamily="var(--font-mono)">
            {ILLUSTRATED_TORSO_TILT}°
          </text>

          {/* knee angle: 135 degrees */}
          <path d="M 220.5 171.5 A 30 30 0 0 0 207.1 225.3" fill="none" stroke="var(--secondary)" strokeWidth="2" />
          <text x="238" y="205" fill="var(--secondary-text)" fontSize="15" fontWeight="700" fontFamily="var(--font-mono)">
            {ILLUSTRATED_KNEE_ANGLE}°
          </text>

          {/* limbs */}
          <g stroke="var(--text)" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.85">
            {[
              ['ankle', 'knee'], ['knee', 'hip'], ['hip', 'shoulder'],
              ['shoulder', 'frontElbow'], ['frontElbow', 'frontWrist'],
              ['shoulder', 'backElbow'], ['backElbow', 'backWrist']
            ].map(([a, b]) => (
              <line key={`${a}-${b}`}
                    x1={FIGURE[a].x} y1={FIGURE[a].y}
                    x2={FIGURE[b].x} y2={FIGURE[b].y} />
            ))}
          </g>

          <circle cx={FIGURE.head.x} cy={FIGURE.head.y} r={FIGURE.head.r}
                  fill="var(--surface)" stroke="var(--text)" strokeWidth="3.5" opacity="0.85" />

          <g fill="var(--surface)" stroke="var(--text)" strokeWidth="2">
            {['ankle', 'knee', 'hip', 'shoulder', 'frontElbow', 'backElbow'].map((j) => (
              <circle key={j} cx={FIGURE[j].x} cy={FIGURE[j].y} r="4.5" />
            ))}
          </g>

          {/* contact point and ball — coral is reserved for impact */}
          <circle cx="183" cy="75" r="9" fill="var(--accent)" opacity="0.25" />
          <circle cx="183" cy="75" r="9" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          <circle cx="243" cy="104" r="11" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          <path d="M 252 96 Q 272 70 280 40" fill="none" stroke="var(--accent)" strokeWidth="2"
                strokeDasharray="3 4" markerEnd="url(#hiwArrow)" opacity="0.7" />
          <defs>
            <marker id="hiwArrow" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 z" fill="var(--accent)" />
            </marker>
          </defs>
          <text x="196" y="96" fill="var(--accent)" fontSize="11" fontWeight="600">contato</text>

          {/* hip lead over the ankle */}
          <line x1="180" y1="262" x2="180" y2="286" stroke="var(--warning)" strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="214" y1="128" x2="214" y2="286" stroke="var(--warning)" strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="180" y1="286" x2="214" y2="286" stroke="var(--warning)" strokeWidth="2.5" />
          <text x="222" y="290" fill="var(--warning-text)" fontSize="11" fontFamily="var(--font-mono)">avanço do quadril</text>
        </svg>

        <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {METRICS.map((m) => <Metric key={m.label} {...m} />)}
        </div>
      </div>

      <div style={{
        marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)',
        display: 'flex', gap: 28, flexWrap: 'wrap'
      }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="font-semibold text-sm" style={{ marginBottom: 4 }}>Grave de perfil sempre que puder</p>
          <p className="text-sm text-muted">
            De lado, dá para ver se o tronco vai para trás ou para frente. De frente, essa diferença
            simplesmente não existe na imagem — nenhum método consegue separá-las. Por isso o app mostra
            um valor de <strong style={{ color: 'var(--text)' }}>conf</strong> ao lado da fase: quanto
            mais perto de 1, mais confiável é a leitura do sentido do arqueamento.
          </p>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="font-semibold text-sm" style={{ marginBottom: 4 }}>A bola tem peso decisivo no resultado</p>
          <p className="text-sm text-muted">
            A altura da bola vem do rastreamento balístico da trajetória e validação física contra a gravidade (9,8 m/s²).
            Quando medida com sucesso, a <strong>altura da bola compõe 30% da nota final</strong> (faixa ideal: 1,80m a 2,80m acima do contato).
            Se o rastreio falhar, os campos exibem <strong style={{ color: 'var(--text)' }}>“—”</strong> e a nota passa a considerar 100% a postura biomecânica.
          </p>
        </div>
      </div>
    </div>
  );
}
