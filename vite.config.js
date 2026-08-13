import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// Custom Vite plugin to handle HTTP 206 Byte Range Requests for MP4 video files
function videoRangePlugin() {
  return {
    name: 'vite-video-range-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && (req.url.endsWith('.mp4') || req.url.endsWith('.webm'))) {
          const filePath = path.join(process.cwd(), 'public', req.url.split('?')[0]);
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
              const parts = range.replace(/bytes=/, "").split("-");
              const start = parseInt(parts[0], 10);
              const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
              const chunksize = (end - start) + 1;
              const file = fs.createReadStream(filePath, { start, end });

              res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
              });
              file.pipe(res);
              return;
            } else {
              res.writeHead(200, {
                'Content-Length': fileSize,
                'Accept-Ranges': 'bytes',
                'Content-Type': 'video/mp4',
              });
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          }
        }
        next();
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), videoRangePlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173
  }
});
