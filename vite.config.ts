import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    // Honour an assigned PORT so more than one dev server can run side by side;
    // 5173 stays the default, which is what Spotify's redirect URI is registered
    // against, so plain `npm run dev` is unchanged.
    port: Number(process.env.PORT) || 5173,
  },
})
