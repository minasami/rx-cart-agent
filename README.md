# Rx Cart Agent: AI pharmacy order agent (PayPal AI Hackathon prototype)

An open-source demo. A patient uploads a **synthetic** prescription image. An AI model transcribes the medicine names and quantities. The app matches them against a small **synthetic** catalog from a fictional pharmacy and builds a cart. A **pharmacist must confirm** the cart. Only then is payment taken through **PayPal Orders v2 (sandbox)**.

> ⚠️ Demo only. All medicines, prices and prescriptions are fictional. The app gives no clinical, dosing or substitution advice. Items that are not found or out of stock are flagged, never swapped. No real payments are taken.

## Stack
Next.js (App Router) on Vercel · Vercel AI SDK (`generateObject`, vision) through AI Gateway · PayPal Orders v2 REST + `@paypal/react-paypal-js` · zod.

## Run
```bash
npm install
cp .env.example .env.local   # set PHARMACIST_DEMO_PIN; everything else can stay mock
npm run dev                  # full flow in MOCK mode, no keys needed
npm test                     # vitest: matching, cart validation, PIN gate + rate limit, PayPal errors, approval tokens, routes
```
Real providers: `AI_PROVIDER=gateway` + `AI_GATEWAY_API_KEY`; `PAYPAL_MODE=sandbox` + sandbox `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`/`NEXT_PUBLIC_PAYPAL_CLIENT_ID`.

## Agent mode
`POST /api/agent`: an AI SDK agent with two tools. `build_cart` and `create_paypal_order`, which wraps the PayPal Agent Toolkit `create_order` (orders.create only). The pharmacist PIN is checked on the server. The tool schemas expose no amounts or approval, so the model can't bypass the gate.

In sandbox agent mode the UI shows the order's PayPal approve (`payer-action`) link; after approving, capture it from the app.

## Flow
1. `POST /api/extract`: image → `{items:[{name,quantity}]}` (clicking a sample runs this automatically)
2. `POST /api/cart`: exact catalog match, stock check, total and a `cartHash` of the reviewed cart (built automatically after extraction; items stay editable, edits require a rebuild)
3. Pharmacist confirm: `POST /api/pharmacist/verify` (PIN checked on the server), then `POST /api/paypal/create-order` with `{items, pharmacistPin, cartHash}`. The server recomputes the cart and rejects a mismatch (409), then returns the order plus a signed `approvalToken`.
4. PayPal Buttons approve → `POST /api/paypal/capture-order` with `{orderID, approvalToken, items}`

Other endpoints: `GET /api/config` (modes), `GET /api/pharmacist/demo-pin` (mock mode only; powers the "Use demo PIN" button, 404 otherwise).

## Security notes (prototype)
- Inputs are validated with zod (quantities are positive integers ≤ 999); errors return JSON 400, PayPal failures 502.
- PIN comparison hashes both values (sha256) before `timingSafeEqual`. PIN endpoints have an in-memory lockout (5 failures per client / 50 global per 10 min → 429).
- Capture requires an HMAC token bound to the order ID and cart hash (15 min TTL, single use). `MOCK-` order IDs are accepted only in mock mode.
- The PayPal OAuth token is cached until shortly before it expires.
- Rate-limit state, the capture registry and (unless `APPROVAL_TOKEN_SECRET` is set) the token secret are per-process memory: fine for a demo, not for production.

## License
MIT. See LICENSE.
