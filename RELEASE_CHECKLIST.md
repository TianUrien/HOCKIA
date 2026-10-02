# Staging → Production release

The release runbook is
[`docs/engineering/operations.md`](docs/engineering/operations.md), section
2 ("Release runbook"): pre-merge review, database push with dry run and
probes, edge-function deploys with the `verify_jwt` flags, web and native,
post-release tagging, and the rollback paths in section 3.

The checklist that used to live here (2026-02) was folded into that runbook
on 2026-10-02; its bundle budgets and `tsc` command had gone stale. Keep the
runbook current instead of this file.
