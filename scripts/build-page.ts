import { rm } from 'node:fs/promises';
import { PAGE_ENTRYPOINT, PUBLIC_DIR } from './shared/constants.ts';

/**
 * Bundles the page — its script, stylesheet, fonts and favicon — into the public folder.
 * Shared by the dev and build scripts, and runnable on its own.
 */
export async function buildPage() {
  console.log('🧹 Cleaning public dir...');
  await rm(PUBLIC_DIR, { recursive: true, force: true });

  console.log('📄 Bundling the page...');
  const result = await Bun.build({
    entrypoints: [PAGE_ENTRYPOINT],
    outdir: PUBLIC_DIR,
    target: 'browser',
    minify: true,
    naming: {
      entry: '[name].[ext]',
      chunk: '[name]-[hash].[ext]',
      asset: '[name]-[hash].[ext]',
    },
  });
  if (!result.success) {
    console.error('❌ Page bundle failed:', JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

if (import.meta.main) {
  await buildPage();
}
