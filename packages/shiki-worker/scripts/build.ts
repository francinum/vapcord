import { build } from '@lib/build'

build({
  entry: 'src/index.plugin.ts',
  dependencies: [
    {
      entry: 'src/api/shiki.worker.ts',
      export: '__SHIKI_WORKER__',
    },
  ],
  options: {
    loader: {
      '.json': 'text',
    },
  },
  dev: process.env.NODE_ENV === 'development',
})
