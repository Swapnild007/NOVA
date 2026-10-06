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
