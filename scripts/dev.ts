import { buildPage } from './build-page.ts';
import { ENTRYPOINT, PUBLIC_DIR_NAME, PUBLIC_DIR_NAME_CONSTANT_NAME } from './shared/constants.ts';

await buildPage();

const proc = Bun.spawn(
  [
    'bun',
    'run',
    // Ties the server's lifetime to this wrapper: Ctrl-C or a killed parent takes the
    // server down with it instead of leaving :3000 held by an orphan.
    '--no-orphans',
    '--define',
    `${PUBLIC_DIR_NAME_CONSTANT_NAME}="${PUBLIC_DIR_NAME}"`,
    ENTRYPOINT,
  ],
  // stdio is inherited so the child keeps the terminal (TTY) and its output stays colored
  { stdio: ['inherit', 'inherit', 'inherit'] },
);

process.exit(await proc.exited);
