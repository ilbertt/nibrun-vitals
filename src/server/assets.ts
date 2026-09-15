import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BunFile } from 'bun';

/* Substituted at build time */
declare const PUBLIC_DIR_NAME: string;

// Where the built page sits when running from source. A compiled binary carries its own
// copy and reads that instead.
const PUBLIC_DIR = resolve(process.cwd(), PUBLIC_DIR_NAME);

/** Keyed by the path of the file relative to the folder it came from. */
export type AssetFiles = Map<string, Blob>;

export function getPublicAssets(): AssetFiles {
  return Bun.isStandaloneExecutable ? readEmbeddedFolder(PUBLIC_DIR_NAME) : readFolder(PUBLIC_DIR);
}

// `assets: [<folder>]` embeds a tree under its basename, which each file keeps as
// the start of its name. Everything is embedded flat, so the name is the filter.
function readEmbeddedFolder(folderName: string): AssetFiles {
  const prefix = `${folderName}/`;

  const files: AssetFiles = new Map();
  // Declared as `Blob`, but each entry is the `BunFile` that carries the embedded path.
  for (const file of Bun.embeddedFiles as readonly BunFile[]) {
    const path = file.name;
    if (path?.startsWith(prefix)) {
      files.set(path.slice(prefix.length), file);
    }
  }
  return files;
}

function readFolder(folder: string): AssetFiles {
  if (!existsSync(folder)) {
    return new Map();
  }

  const files: AssetFiles = new Map();
  for (const entry of new Bun.Glob('**/*').scanSync({ cwd: folder, onlyFiles: true })) {
    const filePath = join(folder, entry);
    // Read eagerly, like the embedded files: a static route can't stream a lazy
    // BunFile, it needs the body in memory.
    const fileType = Bun.file(filePath).type;
    files.set(entry, new Blob([readFileSync(filePath)], { type: fileType }));
  }
  return files;
}
