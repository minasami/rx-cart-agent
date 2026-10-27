# Agentic Commerce option (for the "Best Use of Agentic Commerce" prize)
Checked Oct 24, 2026. Sources: https://developer.paypal.com/ai-tools/toolkit (updated June 4, 2026), https://developer.paypal.com/ai-tools/mcp-server (updated June 30, 2026), https://developer.paypal.com/ai-tools/agent-tools, https://github.com/paypal/agent-toolkit

## What PayPal offers
- **Agent Toolkit** (`@paypal/agent-toolkit`, npm 1.11.0). Works with Vercel AI SDK, OpenAI Agents SDK, LangChain, CrewAI, Bedrock and MCP. Tools include `create_order`, `get_order`, `pay_order`, `create_refund`, invoices, catalog (`create_product`, `list_products`), shipment tracking, subscriptions, disputes, `list_transactions`.
- **MCP server**: local `npx -y @paypal/mcp --tools=all` (npm 1.8.1) with `PAYPAL_ACCESS_TOKEN` and `PAYPAL_ENVIRONMENT=SANDBOX`, or remote `https://mcp.sandbox.paypal.com/sse` (or `/http`) with a Bearer token.

## What it needs
- Sandbox app Client ID + Secret (the same ones as now). For MCP, an access token from the OAuth client-credentials flow.
- A tool-calling model: Google Gemini (`AI_PROVIDER=google`, default `gemini-3.5-flash`) or AI Gateway (`AI_PROVIDER=gateway`).
- A system prompt that limits the agent to the order tools only.

## Proposed design (keeps the human gate)
1. The AI SDK agent gets our own tools `extract_prescription` and `build_cart`, plus PayPal toolkit `create_order` / `get_order` **only** (not refunds, invoices and the rest).
2. `create_order` is wrapped: it refuses unless `pharmacistApproved()` is true (a server-side check). Payer approval stays with PayPal Buttons or the approve link.
3. Show the agent's tool-call trace in the UI for the demo video.
Not yet installed. Add it on the Nov 1 milestone after the core flow works.

## Dependency security overrides

`@paypal/agent-toolkit@1.11.0` pulls old transitive deps (ai v4, zod v3, @langchain/core 0.3, openai 4, mathjs 14, langsmith, uuid, jsondiffpatch) that `npm audit` flagged (12 vulns: 1 moderate, 11 high). `package.json` `overrides` pins them to patched versions (ai/zod follow the app's own pins). Verified: the toolkit still loads, `getTools().create_order` validates input and reaches PayPal OAuth; the 14 tests, typecheck and build pass; `npm audit` reports 0 vulnerabilities. If a future toolkit release breaks under these overrides, fall back to the direct Orders v2 call in `lib/paypal.ts` (same endpoint the toolkit uses: POST /v2/checkout/orders), still behind the server-side PIN gate.
