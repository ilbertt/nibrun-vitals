# Contributing

```bash
bun install
bun run dev          # http://localhost:3000, data in ./data — the /proc readers degrade on macOS
bun run check:all    # types and codestyle; `bun run fix:codestyle` applies what Biome can fix
bun run build        # dist/vitals for linux x64; `bun run build:local` for this machine
```

`src/server` is the binary, `src/page` the page it embeds, `src/server/types.ts` what goes over
the wire between them.

To release, run the **release** workflow from the Actions tab: it builds, tags the commit with the
date (`v2026.9.15-1`, a second cut that day is `-2`) and attaches `vitals-linux-x64` to a GitHub
Release. [nibrun.com/deploy/nibrun-vitals](https://nibrun.com/deploy/nibrun-vitals) — the badge in the
README and the buttons in the app — deploys the newest one.
