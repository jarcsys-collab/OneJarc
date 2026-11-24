# Railway configuration

`railway.ts` describes the OneJarc Railway service (source branch, build and
start commands, healthcheck, replicas, variables) using Railway
[Infrastructure as Code](https://docs.railway.com/infrastructure-as-code).

Railway does **not** read this folder when it deploys. Changes take effect only
when they are applied with the Railway CLI:

```bash
railway login
railway link                  # choose the OneJarc project
railway environment staging   # choose the environment
railway config plan           # preview, changes nothing
railway config apply          # apply after confirming
```

You can also set the same values by hand in the Railway dashboard instead.

Notes:

- The CLI evaluates the file with the `railway` npm package (`railway/iac`);
  it must be installed where you run `railway config plan` (`pnpm add -D railway`
  at the repo root, or a global install).
- Secret and tenant-specific variables are `preserve()`: the value set in the
  dashboard is kept. Set them in the dashboard, never in this file.
- Read every plan before applying. Variables or resources that exist in Railway
  but are missing from `railway.ts` may be shown as deletions.
- Keep exactly one replica while sessions are stored in memory.
