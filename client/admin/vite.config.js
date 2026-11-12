import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* O service worker mora em /admin/sw.js mas precisa de escopo "/", porque o
   cockpit abre na RAIZ do crew. Quem autoriza isso é o header
   `Service-Worker-Allowed: /` — em produção quem responde é o server.js; aqui
   é pro dev/preview se comportar igual, senão o SW só falha na sua máquina. */
const escopoDoServiceWorker = () => {
  const middleware = (server) => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0].endsWith('/sw.js')) {
        res.setHeader('Service-Worker-Allowed', '/');
      }
      next();
    });
  };
  return {
    name: 'nomade-sw-scope',
    configureServer: middleware,
    configurePreviewServer: middleware,
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), escopoDoServiceWorker()],

  // Base path pro build — o admin é servido em /admin no Express
  base: '/admin/',

  server: {
    port: 5173,
    // Em dev, tudo passa pelo ai-service (:5004), igual em produção: /hq vai
    // pro server principal (API + socket do painel), /api é o escritório.
    proxy: {
      '/hq': {
        target: 'http://localhost:5004',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: 'http://localhost:5004',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
