# Isolated Stripe action-time verification — 2026-09-21

Scope: test-mode checkout and refund only. The production license service,
production Stripe resources, and live payment methods were not used.

## Successful checkout

- Service: `photosweep-license-api-test`
- Test account: `pawsitivegames@gmail.com`
- Plan: `mini_cleanup`
- Checkout: Stripe Sandbox, USD 2.99
- Checkout session: `cs_test_a1jdJzQdcBvg4hvAOggN37JBT3dfnnvDZU7eLnFZLnL0UsJTw63Up5vNtP`
- License session: `pls_Gt0Jby53pUwe-YBHtTzojR_d`
- Payment intent: `pi_3UICvDLBMr9lVfE00IRS7I9o`
- Stripe read-only state after Pay: `status=complete`, `payment_status=paid`,
  `customer_email=pawsitivegames@gmail.com`, metadata matched the plan and
  license session.
- The license API returned a signed `mini_cleanup` entitlement. Its ECDSA
  signature verified with the public key derived from the isolated test
  entitlement private key.

## Refund and revocation

- Stripe test refund: `re_3UICvDLBMr9lVfE004zkEtZS`, status `succeeded`, amount
  USD 2.99.
- Stripe charge read-back: `amount_refunded=299`, `refunded=true`.
- After webhook processing, the same license session returned a signed `free`
  entitlement; its ECDSA signature also verified.

## Boundary

This closes the isolated successful-checkout, signed-entitlement, and full
refund-revocation evidence. Local tests cover delayed-payment, dispute,
idempotency, and recovery contracts. Those external lifecycle variants remain
separate from this action-time run unless independently exercised in the
isolated Stripe environment.
