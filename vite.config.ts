import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.NODE_ENV': JSON.stringify(env.NODE_ENV || mode)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        // Increase chunk size warning limit
        chunkSizeWarningLimit: 1200,
        rollupOptions: {
          output: {
            // Split vendor chunks for better caching
            manualChunks: {
              'vendor-react': ['react', 'react-dom', 'react-router-dom'],
              'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            }
          }
        }
      }
    };
});
