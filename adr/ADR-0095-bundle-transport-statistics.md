# ADR-0095 — Bundle transport statistics by task type

Status: accepted, 2026-10-06.

The lower-right workspace bundle counter previously counted only canonical chat
artifacts. On 2026-10-06 it reported zero uploads while the same three-hour window
contained 135 confirmed uploads, predominantly UI Lab exchanges.

The counter now projects the existing persisted operational ledger, counting
confirmed uploads across all task types and completed bundle downloads. It exposes
per-type sent/received/total statistics through the existing quota endpoint and
an accessible popup opened from that same footer counter. Task ids and request
ids resolve through the existing task catalog; unknown types remain visible.

New download metadata records include filename, task and byte count. Historical
utility deliveries are inferred from local bundle-bearing HTTP routes and labelled
as estimates. Completed-download evidence takes precedence over delivery evidence
for the same exchange. The old artifact projection remains available only for
development stores without PostgreSQL operational persistence.

There is no new database table, provider request, approval or executable protocol.
The existing quota JSON fields remain; breakdown and provenance fields are additive.
The estimate is local and does not assert the provider's authoritative quota.
Transport recording uses the existing asynchronous redacted console-log shipper.
