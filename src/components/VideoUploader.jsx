import React, { useRef, useState } from 'react';
import { Upload, Video as VideoIcon, Activity } from 'lucide-react';
import HowItWorks from './HowItWorks';

export default function VideoUploader({ onSelectVideo }) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleFile = (file) => {
    if (!file.type.startsWith('video/')) {
      setError('Formato não suportado. Envie um arquivo MP4, MOV ou WEBM.');
      return;
    }
    setError(null);
    onSelectVideo({ url: URL.createObjectURL(file), file, name: file.name });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center" style={{ marginBottom: 32 }}>
        <span className="badge badge-accent" style={{ marginBottom: 14 }}>
          <Activity size={14} strokeWidth={2} />
          Biomecânica da peitada
        </span>
        <h1 className="md:text-4xl" style={{ marginBottom: 12 }}>
          Meça a técnica da sua peitada
        </h1>
        <p className="text-muted max-w-xl mx-auto">
          Envie um vídeo e receba as medidas do movimento quadro a quadro. Funciona de qualquer
          ângulo, mas <strong style={{ color: 'var(--text)' }}>de perfil</strong> é onde a medida
          é mais confiável.
        </p>
      </div>

      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`dropzone p-8 md:p-10 ${dragActive ? 'dropzone-active' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        <div style={{
          width: 56, height: 56, margin: '0 auto 16px',
          borderRadius: 'var(--r-btn)',
          background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
          color: 'var(--primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Upload size={26} strokeWidth={1.75} />
        </div>

        <h3 style={{ marginBottom: 6 }}>Arraste seu vídeo aqui</h3>
        <p className="text-sm text-muted" style={{ marginBottom: 20 }}>
          MP4, MOV ou WEBM · gravado do celular serve
        </p>

        <button type="button" className="btn-accent">
          <VideoIcon size={18} strokeWidth={1.75} />
          <span>Selecionar vídeo</span>
        </button>

        {error && (
          <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 16 }} role="alert">
            {error}
          </p>
        )}
      </div>

      <HowItWorks />
    </div>
  );
}
