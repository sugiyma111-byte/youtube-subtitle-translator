import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'ことのは字幕 — YouTube翻訳',
    description: 'YouTubeの字幕をAIで翻訳。Sarashinaと互換APIに対応し、再生位置に合わせて字幕を表示します。',
    permissions: ['storage'],
    host_permissions: ['https://www.youtube.com/*', 'https://api.sarashina.ai/*'],
    optional_host_permissions: ['https://*/*'],
    minimum_chrome_version: '120',
    options_ui: { page: 'options.html', open_in_tab: true },
  },
});
