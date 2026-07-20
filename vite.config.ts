import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Vite 负责前端开发服务，同时把浏览器里缺失的 Node Buffer 能力补齐。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = `http://localhost:${env.PORT || '3000'}`;

  return {
    plugins: [
      react(),
      // 某些 Solana 依赖在浏览器端仍会访问 Buffer，全局 polyfill 可以避免运行时警告。
      nodePolyfills({
        include: ['buffer'],
        globals: {
          Buffer: true,
          global: true,
        },
      }),
    ],
    server: {
      port: 5174,
      // 把前端开发请求代理到现有 Express 后端，避免本地跨域问题。
      proxy: {
        '/health': apiOrigin,
        '/approvals': apiOrigin,
        '/approve': apiOrigin,
        '/delegate': apiOrigin,
      },
    },
  };
});
