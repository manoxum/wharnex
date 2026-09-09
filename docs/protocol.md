# Agent and Planner Protocols

The canonical agent-turn contract is `schemas/agent-turn.schema.json`. Only a `change` turn may include the execution contract in `schemas/execution-plan.schema.json`. Normative behavior is defined in `SoT/AI_PROTOCOL.md`.

Concurrency metadata is optional on the v1 wire for compatibility: `impact_files` is an early scope forecast, `read_files` lists concrete semantic dependencies, and `barrier_files` lists schema/dependency/build inputs that require broad re-verification if they move. Wharness derives the actual write set after sandbox verification and persists it as an internal ChangeSet; none of these declarations authorizes a path or bypasses Policy.

When BASE/CURRENT/RESULT cannot be merged mechanically, Wharness creates one `harness.conflict/v1` capsule and routes it to a ChatGPT surface dedicated to that conflict. The returned canonical change bundle must modify every and only the listed conflict paths. The primary Harness-chat ChatGPT conversation is not rebound or reused for this support turn.

Remote consumer-Web transport has two independent switches: one self-contained
request ZIP and live Tunnel Providers. They may run together (the default), or
either may run alone; both cannot be disabled. When tunnels are enabled, every
eligible configured provider publishes the request channel and is listed in
numeric priority order. DNS/connection/status/5xx failure advances to the next
endpoint, and exhaustion falls back to the attached ZIP whenever it exists.
A final verification is mandatory whenever tunnels are enabled: immediately
before delivery the model fetches `diff-check.json`, current state, and the file
map from the first reachable provider, then re-checks the actual patch paths
against the current context. Failure advances to the next provider; exhaustion
still falls back to the self-contained ZIP.
A tunnel opens a live main-request channel described by
`schemas/remote-input-channel-manifest.schema.json` and
`schemas/remote-input-channel-state.schema.json`. That channel separates the
prompt, current hash/state, immutable context snapshots, generation attachments,
bundle contract and advisory SSE events. One TryCloudflare origin is retained
for the running backend session; permanent providers instead retain their configured
DNS across restart and rehydrate active channel files. The bootstrap enumerates
all required stable absolute URLs. Only the origin is shared, never the per-request
secret namespace. The transport manifest is not an
execution plan. The model still returns the canonical execution bundle defined
by the existing turn and plan schemas.

Every new `turn.json` includes a mandatory `outcome` object. `completed` means
the planner produced the requested response; it does not claim host execution.
`failed` and `partial` are persisted as request failures, may provide a
`reason_code` and retry guidance, and can never carry or execute a plan.
During canonical WHX self-evolution, `turn.json` may also report bounded
`resolved_evidence_ids`. They must belong to the explicit analysis selection and
are committed to the durable resolution ledger only after verified host Apply.

The tunnel provider pool is configured by
`schemas/tunnel-provider-config.schema.json`. Storage drivers use the separate
`schemas/remote-storage-config.schema.json` and do not participate in ChatGPT transport.


## Artifact presentation manifest

Renderable response files remain under `artifacts/`. When several related files benefit from comparison or navigation, a response may also include `metadata/artifact-presentation.json`:

    {
      "protocol": "harness.artifact-presentation/v1",
      "galleries": [
        {
          "id": "results",
          "title": "Results",
          "layout": "grid",
          "sizing": "adaptive",
          "items": [
            { "path": "artifacts/chart.png", "label": "Chart", "description": "Primary result" },
            { "path": "artifacts/report.md", "label": "Report" }
          ]
        }
      ]
    }

The v1 manifest is presentation-only. Paths and optional `preview_path` must resolve to real same-bundle `artifacts/` entries. Wharnex derives MIME, size, preview kind and toolbar capabilities from validated files; the manifest cannot enable execution or relax sandboxing. Supported layouts are `auto`, `grid`, `masonry`, and `strip`; supported sizing modes are `uniform` and `adaptive`. Missing or invalid manifests fall back to the automatic artifact gallery.
