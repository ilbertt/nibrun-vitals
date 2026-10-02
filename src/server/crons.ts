import { db } from '#store.ts';
import { performWiggle, startWiggles, wiggles } from '#wiggles.ts';

const TITLE = 'mandatory-wiggle';
const SCHEDULE = '*/15 * * * *';
const TITLE_ARG = '--cron-title=';
// Bun folds direct process.env.NODE_ENV reads while bundling. Keep this selection at runtime
// so a binary built in development can still register nibrun's OS-backed scheduler.
const runtimeEnv = process.env;

function runWiggle() {
  const now = Date.now();
  console.log(`${TITLE} started at ${new Date(now).toISOString()}`);
  const added = performWiggle({ now });
  console.log(
    `${TITLE} completed: ${added ? 'wiggle recorded' : 'no new slot'} · ${wiggles().count} total`,
  );
}

// Bun 1.4.2 compiled cron commands pass a title to the entrypoint. Dispatch before
// HTTP, collectors, or boot accounting; a cron invocation is a separate short-lived process.
export function runCronJob(): boolean {
  const arg = process.argv.find((value) => value.startsWith(TITLE_ARG));
  if (!arg) {
    return false;
  }
  try {
    if (arg !== `${TITLE_ARG}${TITLE}`) {
      throw new Error(`Unknown cron job: ${arg}`);
    }
    runWiggle();
    return true;
  } finally {
    db.close();
  }
}

export async function registerCrons({ entrypoint }: { entrypoint: string }): Promise<void> {
  if ((runtimeEnv.NODE_ENV ?? 'production') === 'production') {
    await Bun.cron(entrypoint, SCHEDULE, TITLE);
  } else {
    Bun.cron(SCHEDULE, () => {
      try {
        runWiggle();
      } catch (error) {
        console.error(`${TITLE} failed`, error);
      }
    });
  }
  startWiggles();
}
