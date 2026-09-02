#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../services/backend"
go test ./... -run Integration
