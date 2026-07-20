// 给缺失类型声明的 Vite polyfill 插件补一个最小声明，避免编辑器报错。
declare module 'vite-plugin-node-polyfills' {
  import type { PluginOption } from 'vite';

  export function nodePolyfills(options?: {
    include?: string[];
    globals?: {
      Buffer?: boolean;
      global?: boolean;
      process?: boolean;
    };
  }): PluginOption;
}
