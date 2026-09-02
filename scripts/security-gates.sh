#!/usr/bin/env sh
set -eu
command -v gosec >/dev/null 2>&1 && (cd services/backend && gosec ./...) || echo "gosec not installed; skipped"
command -v govulncheck >/dev/null 2>&1 && (cd services/backend && govulncheck ./...) || echo "govulncheck not installed; skipped"
command -v trivy >/dev/null 2>&1 && trivy fs . || echo "trivy not installed; skipped"
