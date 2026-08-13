import { readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import IconsResolver from 'unplugin-icons/resolver';
import Icons from 'unplugin-icons/vite';
import ViteComponents from 'unplugin-vue-components/vite';
import MotionResolver from 'motion-v/resolver';

const cliVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, '../cli/package.json'), 'utf-8'),
).version as string;

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@vueuse/nuxt', 'unplugin-icons/nuxt', 'motion-v/nuxt'],

  runtimeConfig: {
    public: {
      cliVersion,
      githubUrl: 'https://github.com/logaretm/teley',
      authorName: 'Abdelrahman Awad',
      authorUrl: 'https://awad.dev',
      // Set NUXT_PUBLIC_SENTRY_DSN at build time. Empty disables the SDK.
      sentryDsn: '',
      sentryEnvironment: 'production',
    },
  },

  // Client-side only (local-first architecture)
  ssr: false,

  experimental: {
    componentIslands: true,
  },

  css: ['./app/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
      title: 'Teley',
      meta: [
        {
          name: 'description',
          content: 'A real-time observability dashboard',
        },
      ],
      link: [
        {
          rel: 'icon',
          type: 'image/png',
          href: '/favicon-96x96.png',
          sizes: '96x96',
        },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        {
          rel: 'apple-touch-icon',
          sizes: '180x180',
          href: '/apple-touch-icon.png',
        },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    },
  },

  // Static generation; the worker in ../workers serves .output/public
  nitro: {
    preset: 'static',
  },

  alias: {
    '@types': path.resolve(__dirname, '../types'),
    '@shared': path.resolve(__dirname, '../shared'),
  },

  vite: {
    plugins: [
      tailwindcss() as any,
      Icons({ compiler: 'vue3', autoInstall: false }),
      ViteComponents({
        resolvers: [
          IconsResolver({
            prefix: 'icon',
          }),
          MotionResolver(),
        ],
      }),
    ],
    // Worker configuration for SharedWorker
    worker: {
      format: 'es',
    },
    optimizeDeps: {
      include: ['dexie', 'nanoid'],
    },
    build: {
      sourcemap: true,
    },
  },

  sourcemap: {
    client: true,
  },
});
