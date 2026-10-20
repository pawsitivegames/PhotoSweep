# Pinned TLC tooling

`tla2tools-1.8.0.jar` is the verified TLA+ model checker used by the model and
mutation evidence runners.

- Upstream project: <https://github.com/tlaplus/tlaplus>
- Upstream source commit: `94d0c5070852b37b801bb8998c436383ab7ee37b`
- Upstream immutable commit tag: `2026.10.06.014338`
- SHA-256: `7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d`
- License: MIT; see the upstream repository's `LICENSE` file.

CI installs this checked-in artifact into the canonical ignored path with
`node verification/install-pinned-tlc.mjs`. This avoids relying on the
upstream `v1.8.0` release asset, which is rebuilt in place and can change while
keeping the same download URL. See the upstream project's
[release-asset immutability issue](https://github.com/tlaplus/tlaplus/issues/1399).

Replace the binary only after verifying its official source, upstream commit,
license, model compatibility, and digest. Update the digest consumers and
verification evidence together.
