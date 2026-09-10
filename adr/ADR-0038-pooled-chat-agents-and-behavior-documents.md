# ADR-0038 — Pooled chat agents, one global queue, and behavior documents

## Status

Proposed. Core modules landed and tested; the migration of existing ChatGPT
traffic onto the controller is in progress. Supersedes the one-view-per-chat
rule in `AGENTS.md` section 8 once that migration completes.

## Context

Every live Wharnex chat owned its own ChatGPT `WebContentsView`. That gave each
chat a stable surface, but it ties resident cost to chat count: thirty chats
means thirty Chromium renderers on one authenticated partition. Wharnex is
routinely used with many more chats than there are conversations actively being
driven at any instant, so most of those renderers are idle weight.

The surfaces also had no shared scheduler. Each chat drove its own view
independently, so nothing could express "a user is waiting on a prompt, finish
that before resuming background inspection", and nothing prevented two
operations from interleaving on the same page.

Separately, every selector, label and timing was compiled into control flow.
A ChatGPT UI change therefore required a code change, and adding a second AI
provider would have meant a parallel implementation of the same verbs.

## Decision

### Instances are pooled, not owned

A small pool of `WebContentsView` slots is rotated across chats. Sizing:

- one chat holds the pool at exactly one slot;
- two or more chats raise the floor to two, so the slot the user is looking at
  is never the slot doing background work;
- the pool grows toward a configurable ceiling (default 3, hard maximum 6) but
  never past the number of chats.

Roles are not interchangeable. Exactly one slot carries the `view` role whenever
more than one slot exists: it follows the active chat and is never given
background inspection, because a background navigation would pull the page out
from under the person reading it. The remaining `worker` slots take everything
else. With a single chat there is nothing to inspect in the background, so one
slot serves both purposes.

A read never takes the viewing slot. A write may, but only when no worker is
free, because a user is waiting on it.

### One global queue, priority ordered, non-preemptive

All agents pull from a single queue. Writes outrank account operations, which
outrank reads: a write is a user waiting on their own prompt, a read is
background inspection that is never urgent.

Dispatch is non-preemptive. A running job is never aborted because something
better arrived. A half-finished read leaves the surface in an unknown state — a
menu open, a navigation mid-flight — and the cost of reasoning about that state
dwarfs the latency saved. An agent finishes its current job, then takes the next
one.

Reads collapse on a dedupe key, because re-asking to inspect a chat that is
already queued for inspection is one job. Writes never collapse: two prompts are
two intents.

### Behavior lives in a document, not in code

An agent is instantiated with a base URL plus a validated behavior document
(`harness.chat-agent-behavior/v1`) holding selectors, menu labels, timing
budgets, verification requirements and anomaly-capture rules. Scripts are built
from that document; nothing is compiled in. A second provider is a second
document, and a UI change is a document change.

Optional controls are declared separately from required ones, because an absent
control can be legitimate: an account with no model picker is data, not a
defect. An unmapped optional control makes its verb report
`capability-unavailable` rather than clicking something adjacent.

A learned overlay may refine a document at runtime, but it may only *extend*
selector lists — never remove a builtin. A UI change should add a way to find a
control, not delete the way that still works for users on an older rollout, and
an overlay that could delete selectors would let one bad learning cycle blind
the agent permanently.

### A job is complete only on its own evidence

A write is not finished when the keystroke is sent; it is finished when the
composer is observed drained and the conversation request is observed starting.
A read is not finished when navigation is requested; it is finished when the
trusted conversation URL is settled and the readiness selector is present. Both
carry bounded timeouts and bounded retries from the document's own budgets, so a
slow network, a ChatGPT error surface, or a stalled page ends as a typed failure
rather than a hang.

### Abnormal situations are captured for evolution

When a verb cannot find its control, the agent captures a bounded structural
snapshot — tags, attributes and nesting, never text nodes — so a behavior
document can be evolved from evidence. A snapshot kept for evolution must never
become a transcript. Repeated failures of the same shape escalate to explicit
human attention rather than retrying indefinitely.

### Visible reasoning is captured structurally

ChatGPT collapses completed reasoning behind a disclosure ("Processou durante
5m 23s"); expanding it is what makes the summary rows readable at all. Rows are
selected structurally: short prose lines that are not inside, and do not
contain, a code or markdown region. That is what separates "Validou estilos e
temas da interface" from the tool/code block beside it. Wrapper elements report
the concatenation of the rows beneath them, so any candidate that strictly
contains another candidate is discarded as a wrapper.

This is a deliberate, bounded exception to the prohibition on reading generated
output, scoped to the reasoning summary rows of a Wharnex-driven conversation and
surfaced to the user as "Raciocínio visível do ChatGPT". It does not extend to
answer prose, and completion is still never inferred from it.

## Consequences

- Resident cost decouples from chat count: three slots serve any number of
  chats, at the price of navigation latency when a worker must move between
  conversations.
- A chat is no longer guaranteed a warm surface; the affinity map (chat →
  conversation URL) becomes the durable binding and the view becomes a cache.
- Priority inversion is possible by construction: a long read delays a write
  that arrives mid-job. This is accepted deliberately in exchange for never
  leaving a surface in an unknown state, and is bounded by the read's own
  timeout.
- Trusted native clicks land on hidden views (verified), which is what makes
  worker slots usable without showing them.
- Two effort settings become meaningful and must not be conflated: Wharnex's own
  execution effort, and the provider-side reasoning effort passed to the chat
  along with the requested model.
