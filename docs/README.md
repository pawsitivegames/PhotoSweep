# Documentation map

Use this page to find the canonical document for a reader task. The root
[README](../README.md) remains the public product and contributor entrypoint.

## Use and validate PhotoSweep

- [Root README](../README.md) — install, everyday usage, safety model, and local
  development commands.
- [Validation checklist](../VALIDATION.md) — automated, live-provider, and paid
  validation procedures. Dated sections are evidence snapshots, not current
  release approval; rerun the applicable gates before shipping.

## Release and operations

- [Paid launch checklist](LAUNCH_CHECKLIST.md) — canonical paid multi-provider
  release gate and external evidence checklist.
- [Licensing backend](LICENSING_BACKEND.md) — API contract, plans, environment
  variables, key handling, recovery, and deployment constraints.
- [Dependency overrides](DEPENDENCY_OVERRIDES.md) — temporary production
  dependency overrides and their required release verification.

## Public trust and support

- [Privacy policy](PRIVACY_POLICY.md) — canonical data-processing and telemetry
  disclosure.
- [Refund policy](REFUND_POLICY.md) — canonical refund and license-handling
  terms.
- [Support](SUPPORT.md) — canonical support channels and safe diagnostic-sharing
  guidance.

## Product planning and store assets

- [Remediation plan](IMPROVEMENT_PLAN.md) — implementation backlog and status
  notes; verify items against code and tests before acting on them.
- [Marketing plan](MARKETING.md) — canonical marketing and listing copy
  direction.
- [Monetization research](MONETIZATION_RESEARCH.md) — background research and
  proposals; it is not a release contract.
- [Monetization system audit](MONETIZATION_SYSTEM_AUDIT.md) — dated audit
  snapshot; its evidence must be refreshed for a new release decision.
- [Chrome Web Store refresh](../store-assets/CHROME_WEB_STORE_REFRESH.md) and
  [SEO proposal](../store-assets/CWS_SEO_OPTIMIZATION.md) — reviewed listing
  proposals that require the documented critic/policy gate before submission.
- [Screenshot set](../store-assets/screenshots/README.md) — asset inventory and
  upload rules.

## Ownership rule

Keep mutable commands and contracts in the root scripts, package manifests,
workflows, or implementation files. These documents explain how to use those
sources and record evidence; do not copy a command into a second document
without updating the canonical owner and its verification path.
