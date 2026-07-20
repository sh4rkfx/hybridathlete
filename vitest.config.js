import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/ui/**', 'src/app.js'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
