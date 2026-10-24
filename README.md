# Rx Cart Agent: AI pharmacy order agent (PayPal AI Hackathon prototype)

An open-source demo. A patient uploads a **synthetic** prescription image. An AI model transcribes the medicine names and quantities. The app matches them against a small **synthetic** catalog from a fictional pharmacy and builds a cart. A **pharmacist must confirm** the cart. Only then is payment taken through **PayPal Orders v2 (sandbox)**.

> ⚠️ Demo only. All medicines, prices and prescriptions are fictional. The app gives no clinical, dosing or substitution advice. Items that are not found or out of stock are flagged, never swapped. No real payments are taken.

## Stack
Next.js (App Router) on Vercel · Vercel AI SDK (`generateObject`, vision) through AI Gateway · PayPal Orders v2 REST + `@paypal/react-paypal-js` · zod.

## Run
```bash
cp .env.example .env.local   # fill in sandbox + AI Gateway keys
npm install && npm run dev
```

## Flow
1. `POST /api/extract`: image → `{items:[{name,quantity}]}`
2. `POST /api/cart`: exact catalog match, stock check, total
3. Pharmacist confirm (demo PIN): `POST /api/paypal/create-order`
4. PayPal Buttons approve → `POST /api/paypal/capture-order`

## License
MIT. See LICENSE.
