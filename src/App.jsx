import React, { useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import VideoUploader from './components/VideoUploader';
import VideoAnalyzer from './components/VideoAnalyzer';
import { applyTheme, getInitialTheme } from './utils/theme';

export default function App() {
  const [activeVideo, setActiveVideo] = useState(null);
  const [theme, setTheme] = useState(getInitialTheme);
  const blobUrlRef = useRef(null);

  useEffect(() => { applyTheme(theme); }, [theme]);

  // Object URLs pin the whole video file in memory until revoked, so every
  // swap has to release the previous one.
  const swapVideo = (videoObj) => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (videoObj?.file) blobUrlRef.current = videoObj.url;
    setActiveVideo(videoObj);
  };

  const handleSelectVideo = swapVideo;
  const handleReset = () => swapVideo(null);

  return (
    <div className="min-h-screen">
      <div className="app-container">
        <Header
          onReset={handleReset}
          onOpenUploader={handleReset}
          activeVideo={activeVideo}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />

        {!activeVideo ? (
          <VideoUploader onSelectVideo={handleSelectVideo} />
        ) : (
          <VideoAnalyzer videoData={activeVideo} />
        )}
      </div>
    </div>
  );
}
