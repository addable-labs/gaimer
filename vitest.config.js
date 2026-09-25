import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { quasar } from '@quasar/vite-plugin'

export default defineConfig({
  plugins: [vue(), quasar()],
  test: {
    environment: 'happy-dom',
    // happy-dom runs no scripts. Without this it logs an error for each
    // script it does not load from a src, as on every game page.
    environmentOptions: {
      happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } }
    },
    globals: true,
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{js,vue}'],
      exclude: ['src/main.js'],
      // The coverage the tests reach, rounded down: yarn test:coverage fails
      // when it drops below
      thresholds: {
        statements: 94,
        branches: 89,
        functions: 90,
        lines: 96
      }
    },
    setupFiles: ['tests/setup.js']
  }
})
