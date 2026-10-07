# NOVA

NOVA is being built as an intelligence workspace rather than a conventional chatbot.

## Architecture

NOVA is intentionally split into layers:

1. **Experience**: desktop/mobile workspace UI.
2. **Cognition**: intent detection, planning, capability selection, verification, memory-ready context.
3. **Capabilities**: talk, research, create, analyze, build, files, vision, voice and actions.
4. **NOVA Shield**: prompt-injection awareness, secret redaction and trust-boundary rules.
5. **Intelligence routing**: a free-first direct-provider core with adaptive health-aware failover and an optional external gateway fallback.
6. **Evaluation**: regression cases for reasoning, research, build, analysis, security and actions.

The goal is one NOVA intelligence, not a collection of provider-specific experiences.

## Intelligence providers

NOVA uses a free-first provider core. Direct provider credentials are server-side only, and NOVA can fail over between independently configured providers when quotas, outages, model access, or transient errors occur.

Provider health is tracked in the running server process so recently failing providers can be temporarily deprioritized. Because serverless instances are ephemeral, this is an instance-local optimization, not a global quota database.

An external OpenAI-compatible gateway is optional and remains a fallback, not a requirement for NOVA to function.


For Cheaper Inference / OmniRoute-compatible routing:

- Base URL: `https://api.cheaperinference.com/v1`
- Chat endpoint: `/chat/completions`
- Model: an exact model ID from the gateway's live catalog
- Routing: `X-CI-Route: auto`
- Optional zero-data-retention mode: `NOVA_GATEWAY_ZDR=true`

Do not put gateway credentials in client-side code.

## Development

```bash
npm install
npm run build
npm run dev
```

## Current build principle

NOVA is being strengthened before deployment. The project should pass capability and regression validation before production deployment or provider spending is treated as the next step.

The autonomous builder currently performs static project validation only. It must not claim that a browser runtime test, shell command, deployment, or external action occurred unless a real connected execution capability performed it.

## Training direction

NOVA is not being trained as a foundation model yet. Its first training layer is a structured cognitive dataset:

`Task -> Intent -> Plan -> Capability -> Execution -> Verification -> Result`

Successful traces, failure cases, security cases and user feedback become evaluation/training data. Fine-tuning or preference optimization comes later, after enough high-quality proprietary examples exist.
