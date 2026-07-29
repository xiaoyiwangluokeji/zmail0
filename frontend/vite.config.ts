import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // 本地开发代理到 wrangler dev（pnpm run dev:backend），不要指向任何线上环境
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
}) 