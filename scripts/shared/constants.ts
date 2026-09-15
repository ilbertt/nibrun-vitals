import { join } from 'node:path';

const ROOT_DIR = join(import.meta.dir, '..', '..');
export const DIST_DIR = join(ROOT_DIR, 'dist');
export const BINARY_FILE = join(DIST_DIR, 'vitals');
export const ENTRYPOINT = 'src/server/main.ts';

/**
 * The page is bundled by Bun's HTML bundler into this folder, which the binary then embeds.
 * Relative to the repo root; the server reads it from the working directory when run from
 * source, and from its embedded files when compiled.
 */
export const PUBLIC_DIR_NAME = 'public';
export const PUBLIC_DIR_NAME_CONSTANT_NAME = 'PUBLIC_DIR_NAME';
export const PUBLIC_DIR = join(ROOT_DIR, PUBLIC_DIR_NAME);
export const PAGE_ENTRYPOINT = 'src/page/index.html';

/**
 * The app is deployed on linux x64 (glibc), so builds target it by default:
 * `bun run build` then produces the same artifact on every machine instead of
 * one that silently depends on whoever ran it.
 *
 * Override with BUILD_TARGET to pick any other Bun compile target, e.g.
 * `bun-linux-x64-musl` (Alpine) or `bun-linux-x64-baseline` (CPUs without
 * AVX2). Use `host` to compile for the current machine — see `build:local`.
 *
 * Cross-compiling downloads a *released* Bun for the target platform, so the
 * version in `.bun-version` has to be one npm actually serves.
 */
export const DEFAULT_BUILD_TARGET = 'bun-linux-x64';

const buildTarget = process.env.BUILD_TARGET || DEFAULT_BUILD_TARGET;

/**
 * `undefined` means "let Bun pick the host platform".
 */
export const BUILD_TARGET =
  buildTarget === 'host' ? undefined : (buildTarget as Bun.Build.CompileTarget);
