import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts', 'tests/security/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Tiap file membuat workerd sendiri; batasi paralelisme agar stabil di laptop.
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.tsx', 'tests/a11y/**/*.test.ts', 'tests/a11y/**/*.test.tsx'],
          setupFiles: ['tests/helpers/web-setup.ts'],
          css: true,
        },
      },
    ],
  },
});
