import { rm } from 'node:fs/promises';
import { buildPage } from './build-page.ts';
import {
  BINARY_FILE,
  BUILD_TARGET,
  DIST_DIR,
  ENTRYPOINT,
  PUBLIC_DIR,
  PUBLIC_DIR_NAME,
  PUBLIC_DIR_NAME_CONSTANT_NAME,
} from './shared/constants.ts';

console.log('🧹 Cleaning dist dir...');
await rm(DIST_DIR, { recursive: true, force: true });

await buildPage();

console.log(`🔨 Compiling binary for ${BUILD_TARGET ?? 'the host platform'}...`);
const buildResult = await Bun.build({
  entrypoints: [ENTRYPOINT],
  compile: {
    outfile: BINARY_FILE,
    // omitted entirely (not set to undefined) so Bun falls back to the host platform
    ...(BUILD_TARGET ? { target: BUILD_TARGET } : {}),
    assets: [PUBLIC_DIR],
  },
  // Compiles the entrypoint to JSC bytecode so the binary skips parsing on every boot.
  // Bun 1.4 lifted this to ES modules; `format` has to be spelled out because `bytecode`
  // on its own still falls back to CommonJS, which top-level `await` cannot use.
  bytecode: true,
  format: 'esm',
  naming: {
    asset: '[dir]/[name].[ext]',
  },
  define: {
    // Update the dev script when updating these
    [PUBLIC_DIR_NAME_CONSTANT_NAME]: JSON.stringify(PUBLIC_DIR_NAME),
  },
  minify: { whitespace: true, syntax: true },
  target: 'bun',
});

if (!buildResult.success) {
  console.error('❌ Build failed:', JSON.stringify(buildResult, null, 2));
  process.exit(1);
}

console.log('✅ Done');
