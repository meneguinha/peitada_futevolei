/**
 * Bridge between the CSS design tokens and code that has to paint pixels
 * (canvas overlays, SVG built in JS).
 *
 * Resolved from the live stylesheet rather than duplicated as JS constants, so
 * there is exactly one place where a brand colour is defined — index.css. That
 * also means these follow the light/dark switch for free.
 */

import { useEffect, useState } from 'react';

const FALLBACK = {
  primary: '#0B3C5D',
  secondary: '#1FA2A6',
  accent: '#FF5A36',
  success: '#2ECC71',
  warning: '#F4C430',
  danger: '#E74C3C',
  surface: '#FFFFFF',
  text: '#1A1A1A',
  textMuted: '#5A5A5A',
  textFaint: '#8A8A8A',
  border: '#E8E2D9',
  stage: '#0F1419'
};

const VAR_NAMES = {
  primary: '--primary',
  secondary: '--secondary',
  accent: '--accent',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
  surface: '--surface',
  text: '--text',
  textMuted: '--text-muted',
  textFaint: '--text-faint',
  border: '--border',
  stage: '--stage'
};

export function getPalette() {
  if (typeof window === 'undefined') return { ...FALLBACK };
  const s = getComputedStyle(document.documentElement);
  const out = {};
  for (const [key, name] of Object.entries(VAR_NAMES)) {
    out[key] = s.getPropertyValue(name).trim() || FALLBACK[key];
  }
  return out;
}

/**
 * Palette for canvas painting, refreshed only when the theme actually changes.
 * Reading the computed style on every animation frame would trigger a style
 * recalculation ~20 times a second for values that change almost never.
 */
export function useThemePalette() {
  const [palette, setPalette] = useState(getPalette);
  useEffect(() => {
    const update = () => setPalette(getPalette());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    update();
    return () => observer.disconnect();
  }, []);
  return palette;
}

export const THEME_STORAGE_KEY = 'peitada-theme';

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0F1419' : '#F7F3EB');
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or storage disabled — the theme still applies for this session.
  }
}

export function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore
  }
  const prefersDark = typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}
