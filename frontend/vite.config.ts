import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // listen on the network too, so a phone on the same Wi-Fi can open the app
    host: true,
    // let a tunnel address (like https://something.trycloudflare.com) open the app. Development only.
    allowedHosts: true,
    proxy: {
      '/api': {
        target:      'http://localhost:4000',
        changeOrigin: true,
      },
      '/ws': {
        target:  'http://localhost:4000',
        ws:      true,
        changeOrigin: true,
      },
    },
  },
})