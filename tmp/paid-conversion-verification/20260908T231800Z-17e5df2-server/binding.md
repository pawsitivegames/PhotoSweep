# Frozen server/P2 verification binding

Verification directory: `tmp/paid-conversion-verification/20260908T231800Z-17e5df2-server/`

## Candidate

- Candidate HEAD: `17e5df2a79b1e161779b92904796acaf6282229b`
- Requested API tip: `17e5df2a79b1e161779b92904796acaf6282229b`
- Package/CWS comparison tip: `4afcf89ac0b2f135b48f399211b9a98f90404092`
- Verification branch: `cursor/paid-conversion-server-verification-42e0`
- Pre-evidence status:

  ```text
  ## cursor/paid-conversion-server-verification-42e0
  ```

- `git diff --check 4afcf89ac0b2f135b48f399211b9a98f90404092..HEAD`: exit `0`

## Dual-bind path check

`git diff --name-only 4afcf89ac0b2f135b48f399211b9a98f90404092..HEAD` returned exactly:

```text
docs/LICENSING_BACKEND.md
server/firestore-license-store.mjs
server/license-api.mjs
tests/server/firestore-license-store.test.ts
tests/server/license-api.test.ts
```

Scope result: `PASS` for the requested server/docs/tests-only delta. No
`tabs/`, `components/`, or `lib/` client product path is in this comparison.
The extension package/CWS claim remains bound to `4afcf89`; this run does not
re-run extension P1–P7.

## SHA-256 of files changed from the package/CWS tip

```text
78ecde48507ef385a7f7d00a89024f1b49d704e99bbbedd5c93987c07da15710  docs/LICENSING_BACKEND.md
fc080c3e0c9ef129075511ac30d4153c2a110785c3d624e65a1e605c380288f1  server/firestore-license-store.mjs
8e68b35914a8ae8cb099e17138667d6cd8a05e59a992397dbcf789b0910e3b63  server/license-api.mjs
c4cb5ec29e2068295f7fe03f370d3f7f80541a2f73a99f53866dc030a4db3dfb  tests/server/firestore-license-store.test.ts
8c7200fca765e503aab7df06c5d0b4732f5ced3f5f8f8ae19b396f8b45491aac  tests/server/license-api.test.ts
```

These hashes bind the fresh local evidence to the frozen source snapshot. They
do not bind any deployed provider, production store, public listing, or revenue
state.
