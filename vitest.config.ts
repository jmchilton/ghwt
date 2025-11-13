import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['dist/__tests__/**/*.test.js'],
    exclude: ['node_modules'],
  },
});
