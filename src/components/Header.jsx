import React from 'react';
import { Video, Sun, Moon } from 'lucide-react';
import Logo from './Logo';

export default function Header({ onReset, onOpenUploader, activeVideo, theme, onToggleTheme }) {
  return (
    <header style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
      gap: 16, paddingBottom: 20, marginBottom: 24,
      borderBottom: '1px solid var(--border)'
    }}>
      <div className="cursor-pointer select-none" onClick={onReset}
           style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo size={38} />
        <span className="badge badge-primary hidden sm:flex">Análise técnica</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onToggleTheme}
          className="btn-icon"
          aria-label={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
          title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          style={{ padding: 8, border: '1.5px solid var(--border)', borderRadius: 'var(--r-btn)' }}
        >
          {theme === 'dark'
            ? <Sun size={20} strokeWidth={1.75} />
            : <Moon size={20} strokeWidth={1.75} />}
        </button>

        {activeVideo && (
          <button onClick={onOpenUploader} className="btn-secondary">
            <Video size={18} strokeWidth={1.75} />
            <span>Novo vídeo</span>
          </button>
        )}
      </div>
    </header>
  );
}
