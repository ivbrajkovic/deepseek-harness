import { defineConfig } from 'tsdown'

const entry = (path: string) => ({
  entry: [path],
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024' as const,
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['./list-models.js', './model-selection.js', './model-selection-state.js'] },
})

/** Build Loader entries and shared selection modules with one discovery registry. */
export default defineConfig([
  entry('lib/types/index.js'),
  entry('lib/types/list-models.js'),
  entry('lib/types/model-selection.js'),
  entry('lib/types/model-selection-state.js'),
  entry('lib/types/model-selection-settings.js'),
])
