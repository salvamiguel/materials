import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Materials — DevOps · Cloud · Automation',
  tagline: 'Terraform · GitOps · Scripting',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  markdown: {
    mermaid: true,
    mdx1Compat: {
      admonitions: true,
    },
  },
  plugins: [
    'drawio',
    function webpackIgnoreVSCodePlugin() {
      return {
        name: 'webpack-ignore-vscode-languageserver',
        configureWebpack() {
          return {
            ignoreWarnings: [
              { message: /Critical dependency: require function/ },
              { module: /vscode-languageserver-types/ },
            ],
          };
        },
      };
    },
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['es'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        docsRouteBasePath: '/',
        indexBlog: false,
      },
    ],
  ],

  url: 'https://salvamiguel.github.io',
  baseUrl: '/materials/',
  organizationName: 'salvamiguel',
  projectName: 'materials',
  trailingSlash: false,

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'es',
    locales: ['es'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/salvamiguel/materials/tree/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Materials',
      items: [
        {type: 'docSidebar', sidebarId: 'terraform', label: 'Terraform', position: 'left'},
        {type: 'docSidebar', sidebarId: 'gitops', label: 'GitOps', position: 'left'},
        {type: 'docSidebar', sidebarId: 'scripting', label: 'Scripting', position: 'left'},
        {type: 'docSidebar', sidebarId: 'ai', label: 'AI', position: 'left'},
        {
          href: 'https://salvamiguel.com',
          label: '← salvamiguel.com',
          position: 'right',
        },
        {
          href: 'https://github.com/salvamiguel/materials',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Salva Miguel Manzanera · Expert Architect · ${new Date().getFullYear()}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'hcl', 'yaml', 'docker'],
    },
    mermaid: {
      theme: { light: 'base', dark: 'base' },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
