#!/usr/bin/env sh
set -eu

gateway_url=${WHARNESS_GATEWAY_URL:-http://127.0.0.1:6969}

GATEWAY_URL="$gateway_url" node <<'NODE'
const payload = JSON.stringify({
  request_id: 'req_gateway_limit_probe',
  direction: 'input',
  kind: 'bundle',
  filename: 'gateway-limit-probe.zip',
  content_type: 'application/zip',
  content_base64: Buffer.alloc(30 * 1024 * 1024).toString('base64'),
})

const response = await fetch(
  `${process.env.GATEWAY_URL}/api/sessions/ses_gateway_limit_probe/artifacts`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  },
)
const body = await response.text()

if (response.status === 413) {
  console.error('gateway rejected a standard 30 MiB bundle part with HTTP 413')
  process.exit(1)
}
if (response.status !== 400 || !body.includes('artifact_persist_failed')) {
  console.error(`gateway did not forward the probe to the backend: HTTP ${response.status} ${body.slice(0, 160)}`)
  process.exit(1)
}

console.log('gateway forwarded a standard 30 MiB bundle part to the backend')
NODE
