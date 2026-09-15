# nibrun-vitals

One Bun binary that reads its own microVM's vitals from `/proc`, counts its visitors in SQLite on
the volume, and serves the page that shows both.

- `src/server` — `Bun.serve`, the collector, the store, the game layer. Imports use the `#*`
  mapping (`#store.ts`), with the `.ts` extension.
- `src/page` — the page: markup, stylesheet, script. Bun's HTML bundler builds it into `public/`,
  which the binary embeds and serves as native static routes.
- `src/server/types.ts` — the wire contract, imported type-only by both sides.
- `scripts/` — build, dev, release. Nothing else runs code.

Biome is the style: single quotes, 100 columns, block statements, one (object) parameter per
function, no magic numbers outside a named `const`. Check your work with `bun run check:all`.
