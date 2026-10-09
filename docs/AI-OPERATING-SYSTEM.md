# NOVA AI Operating System

## Product contract

NOVA is one intelligent workspace that turns a user's intent into useful, verifiable outcomes. It is not a dashboard of disconnected AI modes, and it is not merely a chat UI.

The existing NOVA experience is the product foundation. Preserve its known-good visual identity and evolve it incrementally. Capability selection should happen automatically from the request; do not duplicate Research, Create, Analyze, and Build as competing launch surfaces.

## Core architecture

1. **Experience layer** — one responsive conversation and work surface, with task state and artifacts shown when useful.
2. **Intent and planning** — interpret the goal, identify constraints, decide whether clarification is necessary, and produce a bounded plan.
3. **Capability registry** — typed, discoverable capabilities with input/output contracts, risk classification, and availability.
4. **Execution kernel** — run steps, enforce budgets and timeouts, checkpoint progress, retry only when safe, and support cancellation.
5. **Policy and authority** — least-privilege tool access; ask before irreversible, external, or consequential actions.
6. **Context and memory** — distinguish conversation context from durable user-approved preferences and task/project memory; support inspection and deletion.
7. **Provider routing** — keep model providers behind the server-side gateway, with health-aware fallback and explicit cost/latency limits.
8. **Artifacts and workspace** — persist task outputs as inspectable artifacts rather than burying everything in chat.
9. **Observability and evaluation** — trace intent, plan, capability calls, approvals, failures, verification, and final outcome without exposing secrets.
10. **Recovery** — explicit queued/running/waiting-for-approval/completed/failed/cancelled states; resumable work only where safe.

## Delivery sequence

### Phase 0 — Stabilize the current product
- Preserve the known-good UI baseline.
- Validate mobile composer, keyboard behavior, navigation, chat persistence, and current provider routing.
- Keep all work on a feature branch with Vercel preview validation; do not merge to production on the basis of a successful build alone.

### Phase 1 — Define the execution kernel
- Introduce a typed task/run contract and explicit lifecycle states.
- Normalize capability selection into a plan that can be inspected and tested.
- Add a central policy boundary before tool execution.
- Add structured execution events and safe failure states.
- Keep existing chat requests working while the kernel is introduced incrementally.

### Phase 2 — Make work visible
- Show the current task and meaningful progress when a request needs multiple steps.
- Surface approvals, blocked steps, failures, and completed artifacts.
- Avoid invented progress percentages, unsupported status claims, or fake operational metrics.

### Phase 3 — Persistent project workspace
- Let users inspect, revise, and export generated artifacts.
- Separate chat history from project/task state.
- Add versioning and recovery for work products.

### Phase 4 — Trusted capabilities
- Add capabilities through narrow, typed interfaces.
- Require explicit user approval for consequential external actions.
- Treat web pages, uploaded files, and tool output as untrusted input.
- Keep credentials server-side and scope access to the minimum needed.

### Phase 5 — Memory and adaptation
- Make memory visible, editable, and deletable.
- Record high-quality evaluation traces with sensitive data minimized.
- Use evaluations and user feedback before considering model fine-tuning.

## Required task lifecycle

`created -> planned -> running -> (waiting_for_approval | completed | failed | cancelled)`

A step may be retried only when the operation is safe to repeat. External side effects need idempotency or explicit confirmation. Every terminal result must distinguish verified outcomes from best-effort or unverified output.

## Engineering guardrails

- Never expose provider keys to the browser.
- Never let model-generated text bypass deterministic authorization checks.
- Never claim a tool ran, a file changed, or a deployment succeeded unless the corresponding system confirms it.
- Prefer one well-defined agent/runtime over a multi-agent system unless delegation materially improves the task.
- Add tests for capability routing, policy decisions, failure handling, and regression behavior as the kernel grows.
- Keep production untouched until preview behavior and build checks are verified.

## First implementation milestone

Establish a typed, testable execution contract around the existing intent/capability runtime. Do not replace the current UI or rewrite the provider gateway. First map the existing planning, capability selection, execution planning, and runner code to this contract, then implement the smallest compatible slice with regression tests.
