import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 告诉 Vite 不要处理 node: 协议模块 / Tell Vite not to process node: protocol modules
    external: [/^node:/],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 10000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        execArgv: ['--no-warnings'],
      },
    },
    reporters: ['default'],
    deps: {
      // 不对 node: 内置模块进行打包 / Don't bundle node: built-in modules
      external: [/^node:/],
    },
    server: {
      deps: {
        external: [/^node:/],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/L6-monitoring/dashboard.html'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 70,
        branches: 65,
      },
    },
  },
});
