"use client";
import { useEffect, useRef, useState } from "react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
type Ex = { name: string; quantity: number };
type Cart = { lines: Line[]; totalUSD: string; cartHash: string };
type Line = { requested: string; quantity: number; status: string; match: { name: string; pack: string; priceUSD: number } | null };
const SAMPLES = ["rx-1.png", "rx-2.png", "rx-3.png"];
// Treats non-2xx, non-JSON bodies, {error} and PayPal's error shape ({name, message, debug_id}) as errors.
const post = async (u: string, b: unknown) => {
  const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  let j: any = null; try { j = await r.json(); } catch { /* non-JSON body */ }
  const paypalErr = j && typeof j.name === "string" && typeof j.message === "string";
  if (!r.ok || !j || j.error || paypalErr) throw new Error(j?.error ?? (paypalErr ? `${j.name}: ${j.message}` : `${r.status} ${r.statusText || "Request failed"}`));
  return j;
};

export default function Home() {
  const [cfg, setCfg] = useState({ ai: "mock", paypal: "mock" });
  const [mode, setMode] = useState<"guided" | "agent">("guided");
  const [img, setImg] = useState<string>(); const [sample, setSample] = useState<string>();
  const [items, setItems] = useState<Ex[]>([]); const [cart, setCart] = useState<Cart>();
  const [pin, setPin] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [agent, setAgent] = useState<any>(); const [order, setOrder] = useState<any>(); const [receipt, setReceipt] = useState<any>();
  const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  useEffect(() => { fetch("/api/config").then(r => r.json()).then(setCfg).catch(() => {}); }, []);
  const toDataUrl = (f: Blob) => new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(f); });
  const reset = () => { setItems([]); setCart(undefined); setConfirmed(false); setAgent(undefined); keepOrder(undefined); setReceipt(undefined); setErr(""); };
  const run = async (label: string, f: () => Promise<void>) => { setBusy(label); setErr(""); try { await f(); } catch (e: any) { setErr(e.message); } finally { setBusy(""); } };
  const okItems = () => (cart?.lines ?? []).filter(l => l.status === "ok").map(l => ({ name: l.match!.name, quantity: l.quantity }));
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";
  const orderRef = useRef<any>(undefined); // latest created order (+ server approval token), readable from PayPal callbacks
  const keepOrder = (o: any) => { orderRef.current = o; setOrder(o); };
  const capture = (id: string) => run("Capturing…", async () => setReceipt(await post("/api/paypal/capture-order", { orderID: id, approvalToken: orderRef.current?.approvalToken, items: okItems() })));

  return <main>
    <header><h1>💊 Rx Cart Agent</h1>
      <div><span className={`badge ${cfg.ai === "mock" ? "mock" : ""}`}>AI: {cfg.ai}</span><span className={`badge ${cfg.paypal === "mock" ? "mock" : ""}`}>PayPal: {cfg.paypal}</span></div></header>
    <div className="banner">⚠️ <b>Synthetic demo.</b> Fictional medicines, prices and prescriptions. No clinical, dosing or substitution advice. Items are never swapped. PayPal <b>sandbox</b> only, no real money.</div>

    <section className={`card ${img ? "done" : ""}`}><div className="step">Step 1</div><h2>Upload a prescription</h2>
      <div className="row samples">{SAMPLES.map(s => <img key={s} src={`/samples/${s}`} alt={s} className={sample === s ? "sel" : ""}
        onClick={async () => { reset(); setSample(s); setImg(await toDataUrl(await (await fetch(`/samples/${s}`)).blob())); }} />)}</div>
      <div className="row"><input type="file" accept="image/*" onChange={async e => { const f = e.target.files?.[0]; if (f) { reset(); setSample(undefined); setImg(await toDataUrl(f)); } }} />
        <button disabled={!img || !!busy} onClick={() => run("Reading prescription…", async () => { const j = await post("/api/extract", { imageDataUrl: img, sampleId: sample }); setItems(j.items); setCart(undefined); })}>{busy.startsWith("Reading") ? busy : "Extract medicines with AI"}</button></div>
    </section>

    {items.length > 0 && <section className={`card ${cart ? "done" : ""}`}><div className="step">Step 2</div><h2>Check what the AI read</h2>
      <p className="mute">Edit any mistakes. Names must match the catalog exactly. Nothing is guessed or substituted.</p>
      {items.map((it, i) => <div className="row" key={i}>
        <input style={{ flex: 1 }} value={it.name} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
        <input type="number" min={1} max={999} step={1} style={{ width: 70 }} value={it.quantity} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, quantity: Math.min(999, Math.max(1, Math.floor(+e.target.value) || 1)) } : x))} />
        <button className="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button></div>)}
      <button onClick={() => run("Building cart…", async () => { setCart(await post("/api/cart", { items })); setConfirmed(false); keepOrder(undefined); setAgent(undefined); })}>Build cart</button>
    </section>}

    {cart && <section className="card"><div className="step">Step 3</div><h2>Cart: Demo Pharmacy (fictional)</h2>
      <table><thead><tr><th>Requested</th><th>Qty</th><th>Status</th><th>Line total</th></tr></thead><tbody>
        {cart.lines.map((l, i) => <tr key={i}><td>{l.requested}{l.match && <div className="mute">{l.match.pack}</div>}</td><td>{l.quantity}</td>
          <td>{l.status === "ok" ? <span className="ok">✓ In stock</span> : l.status === "not_found" ? <span className="bad">✕ Not in catalog: no substitute</span> : <span className="warn">⚠ Out of stock</span>}</td>
          <td>{l.status === "ok" ? `$${(l.match!.priceUSD * l.quantity).toFixed(2)}` : "-"}</td></tr>)}
      </tbody></table><p className="total">Total: ${cart.totalUSD}</p></section>}

    {cart && <section className={`card ${confirmed ? "done" : ""}`}><div className="step">Step 4</div><h2>Pharmacist confirmation</h2>
      <p className="mute">A pharmacist reviews the cart. The PIN is checked <b>on the server</b> before any PayPal order can be created, including by the AI agent.</p>
      <div className="row"><input type="password" placeholder="Pharmacist PIN" value={pin} onChange={e => setPin(e.target.value)} />
        <button disabled={!pin || Number(cart.totalUSD) <= 0} onClick={() => setConfirmed(true)}>Confirm cart</button>
        {confirmed && <span className="ok">✓ Confirmed (verified at order creation)</span>}</div></section>}

    {cart && <section className="card"><div className="step">Step 5</div><h2>Pay</h2>
      <div className="row tabs"><button className={mode === "guided" ? "" : "ghost"} onClick={() => setMode("guided")}>PayPal button</button>
        <button className={mode === "agent" ? "" : "ghost"} onClick={() => setMode("agent")}>🤖 AI agent (PayPal Agent Toolkit)</button></div>

      {mode === "agent" && <>
        <p className="mute">The agent calls <code>build_cart</code>, then <code>create_paypal_order</code> (PayPal Agent Toolkit <code>create_order</code>, behind the server-side pharmacist gate). It controls no prices.</p>
        <button disabled={!!busy} onClick={() => run("Agent working…", async () => { const r = await post("/api/agent", { items: okItems().length ? items : items, pharmacistPin: confirmed ? pin : "", cartHash: cart?.cartHash }); setAgent(r); const o = [...r.trace].reverse().find((t: any) => t.tool === "create_paypal_order")?.output; if (o?.id && r.approval) keepOrder({ ...o, approvalToken: r.approval.approvalToken }); })}>{busy === "Agent working…" ? busy : "Run agent"}</button>
        {agent && <><p><b>Agent:</b> {agent.text}</p><pre className="trace">{agent.trace.map((t: any) => `▶ ${t.tool}\n${JSON.stringify(t.output, null, 1).slice(0, 600)}`).join("\n\n")}</pre></>}
        {order?.id && !receipt && (cfg.paypal === "mock" ? <button onClick={() => capture(order.id)}>Approve & capture (mock sandbox)</button>
          : <p className="mute">Sandbox order {order.id} created. Approve it via its PayPal approve link (<code>links[rel=payer-action]</code>), then capture.</p>)}
      </>}

      {mode === "guided" && (!confirmed ? <p className="mute">Confirm the cart first.</p> :
        cfg.paypal === "mock" || !clientId
          ? <button disabled={!!busy} onClick={() => run("Paying…", async () => { const o = await post("/api/paypal/create-order", { items: okItems(), pharmacistPin: pin, cartHash: cart?.cartHash }); keepOrder(o); setReceipt(await post("/api/paypal/capture-order", { orderID: o.id, approvalToken: o.approvalToken, items: okItems() })); })}>Pay with PayPal (mock sandbox)</button>
          : <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "capture" }}>
            <PayPalButtons style={{ layout: "vertical" }}
              createOrder={async () => { try { const o = await post("/api/paypal/create-order", { items: okItems(), pharmacistPin: pin, cartHash: cart?.cartHash }); keepOrder(o); return o.id; } catch (e: any) { setErr(e.message); setConfirmed(false); throw e; } }}
              onApprove={async d => capture(d.orderID!)} onError={e => setErr(String(e))} /></PayPalScriptProvider>)}
    </section>}

    {receipt && <section className="card done"><div className="step">Step 6</div><h2>✅ Receipt</h2>
      <p>Status: <b>{receipt.status}</b> · Order <code>{receipt.id}</code>{receipt.mock && <span className="badge mock">mock</span>}</p>
      <p>Paid: <b>${receipt.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? cart?.totalUSD}</b> (sandbox, no real money)</p>
      <p className="mute">Flagged items were not charged and were not substituted.</p></section>}

    {busy && <p className="mute">{busy}</p>}{err && <p className="err">{err}</p>}
  </main>;
}
