import { defineConfig, type Plugin } from 'vite';
import path from 'node:path';

function devConfig(): Plugin {
  return {
    name: 'dev-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url === '/config.json' || url.endsWith('/config.json')) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ serverUrl: 'ws://localhost:8787' }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: '/tiny-realms/',
  plugins: [devConfig()],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [path.resolve(__dirname, '..')] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
