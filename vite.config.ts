import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    if (!env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL.includes('YOUR_PROJECT') ||
        !env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY.includes('YOUR_SUPABASE')) {
      throw new Error('Build requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Set them in the build environment and deploy again.')
    }
  }

  return {
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/@supabase/')) return 'supabase'
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router')) return 'react-vendor'
          },
        },
      },
    },
  }
})
