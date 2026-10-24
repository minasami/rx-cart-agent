"use client";
import { useState } from "react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
type Ex = { name: string; quantity: number };
type Line = { requested: string; quantity: number; status: string; match: { sku: string; name: string; pack: string; priceUSD: number } | null };
const samples = ["rx-1.png", "rx-2.png", "rx-3.png"];

export default function Home() {
  const [img, setImg] = useState<string>(); const [items, setItems] = useState<Ex[]>([]);
  const [cart, setCart] = useState<{ lines: Line[]; totalUSD: string }>(); const [pin, setPin] = useState("");
  const [confirmed, setConfirmed] = useState(false); const [receipt, setReceipt] = useState<any>(); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const toDataUrl = (f: Blob) => new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(f); });
  async function extract() {
    if (!img) return; setBusy(true); setErr("");
    try { const r = await fetch("/api/extract", { method: "POST", body: JSON.stringify({ imageDataUrl: img }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Extraction failed"); setItems(j.items); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function makeCart() { const r = await fetch("/api/cart", { method: "POST", body: JSON.stringify({ items }) }); setCart(await r.json()); setConfirmed(false); }
  const okItems = () => cart!.lines.filter(l => l.status === "ok").map(l => ({ name: l.match!.name, quantity: l.quantity }));
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";

  return <main>
    <h1>Rx Cart Agent</h1>
    <p style={{ background: "#fff3cd", padding: 8 }}>Demo with synthetic data only. Not medical advice. Items are never substituted. PayPal <b>sandbox</b> only.</p>

    <h2>1. Upload a prescription</h2>
    <input type="file" accept="image/*" onChange={async e => e.target.files?.[0] && setImg(await toDataUrl(e.target.files[0]))} />
    <div>Or use a sample: {samples.map(s => <button key={s} onClick={async () => setImg(await toDataUrl(await (await fetch(`/samples/${s}`)).blob()))}>{s}</button>)}</div>
    {img && <img src={img} alt="prescription" style={{ maxWidth: 320, display: "block", margin: "8px 0" }} />}
    <button disabled={!img || busy} onClick={extract}>{busy ? "Reading…" : "Extract medicines"}</button>

    {items.length > 0 && <><h2>2. Extracted items (check and edit)</h2>
      {items.map((it, i) => <div key={i}>
        <input value={it.name} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} style={{ width: 280 }} />
        <input type="number" min={1} value={it.quantity} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, quantity: Math.max(1, +e.target.value) } : x))} style={{ width: 60 }} />
      </div>)}
      <button onClick={makeCart}>Build cart</button></>}

    {cart && <><h2>3. Cart (demo pharmacy)</h2>
      <table><tbody>{cart.lines.map((l, i) => <tr key={i}><td>{l.requested}</td><td>×{l.quantity}</td>
        <td>{l.status === "ok" ? `${l.match!.pack} · $${(l.match!.priceUSD * l.quantity).toFixed(2)}` : l.status === "not_found" ? "❌ Not in catalog (no substitute offered)" : "⚠️ Out of stock"}</td></tr>)}</tbody></table>
      <p><b>Total: ${cart.totalUSD}</b></p>

      <h2>4. Pharmacist confirmation</h2>
      <input type="password" placeholder="Pharmacist PIN" value={pin} onChange={e => setPin(e.target.value)} />
      <button disabled={!pin || Number(cart.totalUSD) <= 0} onClick={() => setConfirmed(true)}>Pharmacist confirms cart</button>
      <small> (The PIN is checked on the server before the PayPal order is created.)</small></>}

    {cart && confirmed && !receipt && <><h2>5. Pay with PayPal (sandbox)</h2>
      {clientId ? <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "capture" }}>
        <PayPalButtons style={{ layout: "vertical" }}
          createOrder={async () => { const r = await fetch("/api/paypal/create-order", { method: "POST", body: JSON.stringify({ items: okItems(), pharmacistPin: pin }) }); const j = await r.json(); if (!r.ok) { setErr(j.error); setConfirmed(false); throw new Error(j.error); } return j.id; }}
          onApprove={async d => { const r = await fetch("/api/paypal/capture-order", { method: "POST", body: JSON.stringify({ orderID: d.orderID }) }); setReceipt(await r.json()); }}
          onError={e => setErr(String(e))} />
      </PayPalScriptProvider> : <p>Set NEXT_PUBLIC_PAYPAL_CLIENT_ID in .env.local to show the sandbox button.</p>}</>}

    {receipt && <><h2>6. Receipt</h2>
      <p>Status: <b>{receipt.status}</b> · Order ID: {receipt.id}</p>
      <p>Amount: ${receipt.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value} (sandbox, no real money)</p></>}

    {err && <p style={{ color: "crimson" }}>{err}</p>}
  </main>;
}
