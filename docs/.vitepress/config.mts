// docs/.vitepress/config.mts
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'DeltaScript',
  base: '/DeltaScript/',
  description: 'A modern, pragmatic typed superset that compiles to JavaScript — with a clean CLI and first-class developer UX.',
  sitemap: { hostname: 'https://ztamdev.github.io/DeltaScript' },
  head: [
    ['script', {}, `
      (function() {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        document.documentElement.style.colorScheme = 'dark';
      })();
    `],
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['link', { rel: 'shortcut icon', href: '/favicon.ico' }],
    ['link', { rel: 'apple-touch-icon', href: '/logo.png' }],
    ['meta', { name: 'theme-color', content: '#7ed957' }],
    ['link', { rel: 'canonical', href: 'https://ztamdev.github.io/DeltaScript/' }],
    ['meta', { name: 'keywords', content: 'DeltaScript, typed superset, transpiler, JavaScript, CLI, language, types, VS Code extension, SpectralLogs' }],
    ['meta', { name: 'description', content: 'DeltaScript — a modern, pragmatic typed superset that compiles to JavaScript, with a clean CLI and first-class developer UX.' }],
    ['meta', { property: 'og:title', content: 'DeltaScript — Typed superset that compiles to JavaScript' }],
    ['meta', { property: 'og:description', content: 'Write .ds files and compile to JavaScript (ESM). Great CLI ergonomics, lightweight static types, and SpectralLogs integration.' }],
    ['meta', { property: 'og:url', content: 'https://ztamdev.github.io/DeltaScript/' }],
    ['meta', { property: 'og:image', content: '/logo.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'DeltaScript — Typed superset to JavaScript' }],
    ['meta', { name: 'twitter:description', content: 'Modern language and CLI to build with confidence. Types, CLI, and SpectralLogs integration.' }],
    ['meta', { name: 'twitter:image', content: 'https://ztamdev.github.io/DeltaScript/logo.png' }]
  ],
  appearance: false,
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Docs', link: '/getting-started' },
      { text: 'Language', link: '/language' },
      { text: 'CLI', link: '/cli' },
      { text: 'Config', link: '/config' },
      { text: 'Examples', link: '/examples' },
      { text: 'VS Code', link: 'https://marketplace.visualstudio.com/items?itemName=ZtaMDev.deltascript-vscode' }, 
      { text: 'GitHub', link: 'https://github.com/ZtaMDev/DeltaScript' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Language', link: '/language' },
          { text: 'Types', link: '/types' },
          { text: 'CLI', link: '/cli' },
          { text: 'Configuration', link: '/config' },
          { text: 'SpectralLogs', link: '/spectrallogs' },
          { text: 'Examples', link: '/examples' },
        ],
      },
    ],
    footer: {
      message:
        'Created by <a href="https://github.com/ZtaMDev" target="_blank" rel="noopener">ZtaMDev</a> · '
        + '<a href="https://github.com/ZtaMDev/DeltaScript" target="_blank" rel="noopener">GitHub</a> · '
        + '<a href="https://www.npmjs.com/package/deltascript" target="_blank" rel="noopener">npm</a>',
      copyright: ' 2025 DeltaScript'
    }
  },
});
