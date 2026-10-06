# NOVA

NOVA is being built as an intelligence workspace rather than a conventional chatbot.

## Foundation

- Next.js
- React
- assistant-ui runtime and primitives
- GitHub as source control
- GitHub Pages static export for the first public shell

The interface is deliberately separated from the model layer so real model providers, tools, files, memory and actions can be connected without rebuilding the product experience.

## Development

```bash
npm install
npm run dev
```

## Direction

NOVA should feel like one intelligence with many capabilities. Internal routing, agents and providers remain implementation details and are not exposed as the primary user experience.


## Intelligence continuity

NOVA uses an OpenAI-compatible intelligence gateway when `NOVA_GATEWAY_URL` is configured. OmniRoute is the preferred gateway because it provides provider/model routing, retries and fallback behavior. If the gateway itself is unavailable, NOVA falls back to its configured direct providers instead of stopping the conversation.

Routing defaults:
- general/create/act: `auto`
- build: `auto/coding`
- research/analyze/plan: `auto/smart`

The gateway is infrastructure, not part of NOVA's user-facing product model. Providers and models remain hidden from the user.

For production, deploy OmniRoute separately from the Vercel NOVA application and set `NOVA_GATEWAY_URL` and `NOVA_GATEWAY_API_KEY` in Vercel. Keep at least one direct provider configured as an emergency path.
