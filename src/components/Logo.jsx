import React from 'react';

/**
 * Brand symbol: the arc of an arched torso, the ball resting on the contact
 * point, and the trajectory line leaving it. Geometric enough to survive being
 * shrunk to a favicon — no detail smaller than the stroke width.
 *
 * `variant` = 'color' | 'mono' — mono inherits currentColor for single-ink use.
 */
export function LogoMark({ size = 40, variant = 'color' }) {
  const arc = variant === 'mono' ? 'currentColor' : 'var(--primary)';
  const ball = variant === 'mono' ? 'currentColor' : 'var(--accent)';
  const path = variant === 'mono' ? 'currentColor' : 'var(--secondary)';

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      {/* chest arc — the peitada itself */}
      <path d="M11 37 C 11 20, 20 11, 34 11"
            stroke={arc} strokeWidth="5" strokeLinecap="round" />
      {/* force / trajectory line leaving the contact point */}
      <path d="M23 24 L 41 24" stroke={path} strokeWidth="4" strokeLinecap="round"
            opacity={variant === 'mono' ? 0.55 : 1} />
      {/* ball at the moment of contact */}
      <circle cx="34" cy="35" r="6.5" fill={ball} />
    </svg>
  );
}

export default function Logo({ size = 40, showWordmark = true }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} />
      {showWordmark && (
        <span style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: size * 0.52,
          letterSpacing: '-0.02em',
          color: 'var(--text)',
          lineHeight: 1
        }}>
          PEITADA<span style={{ color: 'var(--secondary)', fontWeight: 700 }}>.</span>
        </span>
      )}
    </span>
  );
}
