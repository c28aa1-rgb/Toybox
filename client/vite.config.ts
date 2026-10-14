import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const reconstructions = fileURLToPath(new URL('../art/reconstructions', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      // Generated img2threejs factories live outside the client root; watch them so edits
      // reach the review viewer and the game without restarting the dev server.
      name: 'watch-reconstructions',
      configureServer(server) {
        server.watcher.add(reconstructions);
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
    // The review viewer imports img2threejs factories from ../art/reconstructions.
    fs: { allow: ['..'] },
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
