import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/helpers/globalSetup.js',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/ui/**', 'src/app.js'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
