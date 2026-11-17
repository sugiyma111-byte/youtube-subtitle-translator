import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Caption Translator for YouTube',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage'],
    host_permissions: ['https://www.youtube.com/*', 'https://api.sarashina.ai/*'],
    optional_host_permissions: ['https://*/*'],
    minimum_chrome_version: '120',
    icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
  },
});
