import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 기본은 배포된 신호 서버(EC2). 로컬 서버로 개발하려면 VITE_API_TARGET=http://localhost:8080
const apiTarget = process.env.VITE_API_TARGET ?? 'http://13.209.146.140:8080'
const wsTarget = apiTarget.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: wsTarget,
        ws: true,
      },
    },
  },
})
