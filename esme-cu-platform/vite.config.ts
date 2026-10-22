/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  test: {
    // The whole suite is written against the local development adapter, and Vite loads `.env.local`
    // into `import.meta.env` for tests too. A developer who has filled in a real project would
    // otherwise get a red run for a reason that has nothing to do with their change: every store and
    // screen test resolves the provider first, and the provider answers with a network call. Pinned
    // here so "no provider configured" is a property of the test run, not of somebody's file.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
    // PBKDF2 with 210,000 iterations runs once per sign-in, and the screen suites sign in in
    // `beforeEach`. Vitest spawns one isolated worker per file, so a case that measures 3.5s alone
    // crosses the 5s default under that contention and fails as a timeout while being correct. The
    // budget is raised for the run; `asyncUtilTimeout` stays at its 1000ms default, so a control that
    // is genuinely missing still fails fast, and a real hang still fails — at 15s rather than 5s.
    testTimeout: 15_000,
  },
})

