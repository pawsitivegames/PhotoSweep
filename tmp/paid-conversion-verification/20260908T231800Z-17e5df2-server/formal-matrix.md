# Focused formal verification matrix

This matrix is limited to the frozen API/server tip
`17e5df2a79b1e161779b92904796acaf6282229b`. It does not reopen the extension
package/CWS bind at `4afcf89ac0b2f135b48f399211b9a98f90404092`.

| ID | Bounded property | Proof class | Fresh verifier | Pass condition | Scope verdict |
| --- | --- | --- | --- | --- | --- |
| P2.2 | Only a valid server-signed entitlement can unlock paid behavior. | static + test | `npm exec vitest run tests/server/license-api.test.ts tests/server/firestore-license-store.test.ts tests/lib/license-client.test.ts tests/lib/paid-access-lifecycle.test.ts`; inspect token verification and unlock paths. | Forged, malformed, expired, unsigned, or locally injected tokens remain Free; only a public-key-verified token changes the effective plan. | Pending |
| P2.3 | Cancellation, failure, unpaid completion, duplicate/replayed events, and duplicate activation do not create unpaid or duplicate paid access. | test + static | Server webhook lifecycle tests plus delayed-payment and replay cases; inspect event-id and checkout-session idempotency. | Unpaid completion creates no license; paid activation is authoritative; event replay and same checkout session do not duplicate access or purchase analytics. | Pending |
| P2.4 | Local server lifecycle preserves delayed-payment, paid async success, full refund, dispute, checkout expiry, pending revocation, and replay semantics. | static + test | Focused server/store tests, related lifecycle tests, and targeted source inspection. | A pre-activation dispute/refund is recorded before a license exists and later activation remains inactive/free; matching active purchases downgrade; unrelated purchases survive; replay is idempotent. | Pending |
| P2.4-local-store | The local JSON and Firestore-shaped store adapters preserve pending Stripe revocations and lookup indexes required by the lifecycle. | test | `tests/server/firestore-license-store.test.ts` and JSON-store coverage in `tests/server/license-api.test.ts`. | Pending revocations survive storage and can be found by payment identifiers without conflating payments. | Pending |
| P2.4b | Deployed provider/store executes the same lifecycle. | provider + store | Authorized deployed Stripe/provider/store matrix. | Live test-mode checkout, delayed payment, refund/dispute/expiry, replay, and deployed-store evidence pass. | `BLOCKED` — explicitly out of this local run; no provider/store/public PASS claim. |

The static dispute-before-activate check must establish this ordering:

1. `charge.dispute.created` or a full refund with no matching license records a
   pending revocation keyed by the Stripe payment identifiers.
2. A later paid checkout activation applies that pending revocation before it
   can produce paid entitlement.
3. The resulting entitlement is Free, and replay does not create a second
   purchase or analytics event.

The local verdicts are bounded to mocked/in-memory/file/fake-Firestore evidence.
They cannot promote P2.4b or any provider, production store, public, or revenue
claim.
