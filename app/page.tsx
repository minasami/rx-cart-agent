"use client";
import { useEffect, useRef, useState } from "react";
import { PayPalSdkButtons } from "./PayPalSdkButtons";
import { savePending } from "@/lib/pending";
import { SAMPLES, lineStatusText, busyHint, createBusyGuard, demoFallbackFor, loadSample, parseConfig, configBadges, type AppConfig } from "@/lib/client";
type Ex = { name: string; quantity: number };
type Cart = { lines: Line[]; totalUSD: string; cartHash: string };
type Line = { requested: string; quantity: number; status: string; match: { name: string; pack: string; priceUSD: number } | null };
// PayPal approve link from an order (rel payer-action or approve), only if it is an https *.paypal.com URL.
const approveLink = (o: any): string | undefined => {
  const href = (o?.links as any[] | undefined)?.find(l => l?.rel === "payer-action" || l?.rel === "approve")?.href;
  try { const u = new URL(href); return u.protocol === "https:" && (u.hostname === "paypal.com" || u.hostname.endsWith(".paypal.com")) ? u.href : undefined; } catch { return undefined; }
};
// Treats non-2xx, non-JSON bodies, {error} and PayPal's error shape ({name, message, debug_id}) as errors.
const post = async (u: string, b: unknown) => {
  const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  let j: any = null; try { j = await r.json(); } catch { /* non-JSON body */ }
  const paypalErr = j && typeof j.name === "string" && typeof j.message === "string";
  if (!r.ok || !j || j.error || paypalErr) throw new Error(j?.error ?? (paypalErr ? `${j.name}: ${j.message}` : `${r.status} ${r.statusText || "Request failed"}`));
  return j;
};

export default function Home() {
  // undefined until /api/config answers: the header shows a neutral "loading" badge, never a guessed "mock".
  const [cfg, setCfg] = useState<AppConfig>(); const [cfgFailed, setCfgFailed] = useState(false);
  const [mode, setMode] = useState<"guided" | "agent">("guided");
  const [img, setImg] = useState<string>(); const [sample, setSample] = useState<string>();
  const [items, setItemsRaw] = useState<Ex[]>([]); const [cart, setCart] = useState<Cart>(); const [stale, setStale] = useState(false);
  const [pin, setPin] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [agent, setAgent] = useState<any>(); const [order, setOrder] = useState<any>(); const [receipt, setReceipt] = useState<any>();
  const [err, setErr] = useState(""); const [busy, setBusyState] = useState("");
  // Elapsed time of the current busy step, so a slow AI call shows progress instead of a frozen spinner.
  const [busySince, setBusySince] = useState(0); const [tick, setTick] = useState(0);
  useEffect(() => { if (!busy) return; const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, [busy]);
  // AI extraction failed: offer the labeled demo fixture (bundled samples only). demoUsed labels the items as demo data.
  const [aiFailed, setAiFailed] = useState(false); const [demoUsed, setDemoUsed] = useState(false);
  // Synchronous guard: `busy` state is stale inside async handlers, so double clicks / clicks mid-run are rejected here.
  const guard = useRef(createBusyGuard()).current;
  const setBusy = (l: string) => { guard.set(l); setBusyState(guard.busy); };
  const [hydrated, setHydrated] = useState(false); const [loadingSample, setLoadingSample] = useState<string>();
  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    let live = true;
    fetch("/api/config", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(j => { const c = parseConfig(j); if (!live) return; if (c) setCfg(c); else setCfgFailed(true); })
      .catch(() => { if (live) setCfgFailed(true); });
    return () => { live = false; };
  }, []);
  const toDataUrl = (f: Blob) => new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(f); });
  const reset = () => { setAiFailed(false); setDemoUsed(false); setItemsRaw([]); setStale(false); setCart(undefined); setConfirmed(false); setAgent(undefined); keepOrder(undefined); setReceipt(undefined); setErr(""); };
  const run = async (label: string, f: () => Promise<void>) => { if (!guard.tryStart(label)) return; setBusyState(label); setBusySince(Date.now()); setTick(Date.now()); setErr(""); try { await f(); } catch (e: any) { setErr(e.message); } finally { guard.end(); setBusyState(""); } };
  const okItems = () => (cart?.lines ?? []).filter(l => l.status === "ok").map(l => ({ name: l.match!.name, quantity: l.quantity }));
  const clientId = cfg?.paypalClientId ?? ""; // served at runtime by /api/config (sandbox only)
  const orderRef = useRef<any>(undefined); // latest created order (+ server approval token), readable from PayPal callbacks
  const keepOrder = (o: any) => { orderRef.current = o; setOrder(o); };
  // Editing items after the cart was built marks the cart stale: confirmation and payment are hidden until rebuilt.
  const setItems = (next: Ex[]) => { setItemsRaw(next); if (cart) { setStale(true); setConfirmed(false); } };
  const buildCartFor = async (its: Ex[]) => {
    setCart(await post("/api/cart", { items: its })); setStale(false); setConfirmed(false); keepOrder(undefined); setAgent(undefined); setReceipt(undefined);
  };
  const doExtract = async (imageDataUrl: string, sampleId?: string) => {
    setAiFailed(false); setDemoUsed(false);
    let j: any;
    try { j = await post("/api/extract", { imageDataUrl, sampleId }); } catch (e) { setAiFailed(true); throw e; }
    await applyExtracted(j);
  };
  // Labeled demo fallback: the server returns the bundled mock fixture for this sample (no AI call).
  const demoExtract = (sampleId: string) => run("Loading demo extraction…", async () => {
    const j = await post("/api/extract", { sampleId, demo: true }); setAiFailed(false); setDemoUsed(true); await applyExtracted(j);
  });
  const applyExtracted = async (j: any) => {
    setItemsRaw(j.items); setCart(undefined); setStale(false);
    if (j.items?.length) { setBusy("Building cart…"); await buildCartFor(j.items); } // auto-build; items stay editable
  };
  const extract = (imageDataUrl: string, sampleId?: string) => run("Reading prescription…", () => doExtract(imageDataUrl, sampleId));
  // One guarded run from click to cart: busy feedback shows immediately, fetch/read errors surface in the error toast.
  const pickSample = (s: string) => run("Loading sample…", async () => {
    reset(); setSample(s); setImg(undefined); setLoadingSample(s);
    try {
      const d = await loadSample(s, fetch, toDataUrl); setImg(d);
      setBusy("Reading prescription…"); await doExtract(d, s);
    } finally { setLoadingSample(undefined); }
  });
  // Redirect flow: keep the approval for this order in this tab (sessionStorage), then go to PayPal; it returns to /return?token=<id>.
  const goApprove = (o: any) => {
    const href = approveLink(o); if (!href) throw new Error(`PayPal returned no approve link for order ${o?.id}`);
    savePending(sessionStorage, { orderID: o.id, approvalToken: o.approvalToken, items: okItems(), totalUSD: cart?.totalUSD });
    window.location.assign(href);
  };
  // Capture with the server-signed approval token issued for THIS order (popup onApprove, agent order, or mock).
  const capture = (id: string) => run("Capturing…", async () => {
    const o = orderRef.current; if (o?.id !== id || !o?.approvalToken) throw new Error(`No capture approval held for order ${id}. Create the order again.`);
    setReceipt(await post("/api/paypal/capture-order", { orderID: id, approvalToken: o.approvalToken, items: okItems() }));
  });

  return <main>
    <header><h1>💊 Rx Cart Agent</h1>
      <div aria-live="polite" aria-busy={!cfg && !cfgFailed}>{configBadges(cfg, cfgFailed).map(b => <span key={b.label.split(":")[0]} className={`badge ${b.tone === "real" ? "" : b.tone}`}>{b.label}</span>)}</div></header>
    <div className="toasts" aria-live="polite">
      {busy && <div className="toast busy" role="status"><span className="spin" aria-hidden="true" />{busy}{tick && busyHint(tick - busySince) ? <span className="mute" style={{ marginLeft: 8 }}>{busyHint(tick - busySince)}</span> : null}</div>}
      {err && <div className="toast error" role="alert"><span>⚠️ {err}</span><button className="ghost" aria-label="Dismiss error" onClick={() => setErr("")}>✕</button></div>}
    </div>
    <div className="banner">⚠️ <b>Synthetic demo.</b> Fictional medicines, prices and prescriptions. No clinical, dosing or substitution advice. Items are never swapped. PayPal <b>sandbox</b> only, no real money.</div>

    <section className={`card ${img ? "done" : ""}`}><div className="step">Step 1</div><h2>Upload a prescription</h2>
      <div className="row samples" aria-busy={!hydrated || !!loadingSample}>{SAMPLES.map(s =>
        <button key={s} type="button" className={`sample ${sample === s ? "sel" : ""} ${loadingSample === s ? "loading" : ""}`}
          disabled={!hydrated || !!busy} aria-pressed={sample === s} title={hydrated ? `Use sample ${s}` : "Loading…"} onClick={() => pickSample(s)}>
          <img src={`/samples/${s}`} alt={`Sample prescription ${s}`} />{loadingSample === s && <span className="spin" aria-hidden="true" />}</button>)}
        {!hydrated && <span className="mute">Loading…</span>}</div>
      <div className="row"><input type="file" accept="image/*" disabled={!!busy} onChange={async e => { const f = e.target.files?.[0]; if (f) { reset(); setSample(undefined); setImg(await toDataUrl(f)); } }} />
        <button disabled={!img || !!busy} onClick={() => img && extract(img, sample)}>{busy.startsWith("Reading") ? busy : "Extract medicines with AI"}</button></div>
      {aiFailed && !busy && <div className="row demo-fallback" role="note">
        {demoFallbackFor(sample)
          ? <><button className="ghost" onClick={() => demoExtract(demoFallbackFor(sample)!)}>Use demo extraction</button>
            <span className="mute">AI extraction is unavailable right now. This loads the bundled <b>demo</b> answer for {sample} (mock data, not read by AI).</span></>
          : <span className="mute">AI extraction is unavailable right now. Retry later, or pick a bundled sample to use its demo extraction.</span>}
      </div>}
    </section>

    {items.length > 0 && <section className={`card ${cart ? "done" : ""}`}><div className="step">Step 2</div><h2>{demoUsed ? "Check the demo extraction" : "Check what the AI read"}{demoUsed && <span className="badge mock">DEMO data, not read by AI</span>}</h2>
      <p className="mute">Edit any mistakes. Names must match the catalog exactly. Nothing is guessed or substituted.</p>
      {items.map((it, i) => <div className="row" key={i}>
        <input style={{ flex: 1 }} value={it.name} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
        <input type="number" min={1} max={999} step={1} style={{ width: 70 }} value={it.quantity} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, quantity: Math.min(999, Math.max(1, Math.floor(+e.target.value) || 1)) } : x))} />
        <button className="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button></div>)}
      <div className="row"><button disabled={!!busy || items.length === 0} className={cart && !stale ? "ghost" : ""} onClick={() => run("Building cart…", () => buildCartFor(items))}>{cart ? "Rebuild cart" : "Build cart"}</button>
        {stale && <span className="warn">Items changed. Rebuild the cart before confirming.</span>}</div>
    </section>}

    {cart && <section className={`card ${stale ? "stale" : ""}`}><div className="step">Step 3</div><h2>Cart: Demo Pharmacy (fictional)</h2>
      <table><thead><tr><th>Requested</th><th>Qty</th><th>Status</th><th>Line total</th></tr></thead><tbody>
        {cart.lines.map((l, i) => <tr key={i}><td>{l.requested}{l.match && <div className="mute">{l.match.pack}</div>}</td><td>{l.quantity}</td>
          <td><span className={l.status === "ok" ? "ok" : l.status === "not_found" ? "bad" : "warn"}>{lineStatusText(l.status)}</span></td>
          <td>{l.status === "ok" ? `$${(l.match!.priceUSD * l.quantity).toFixed(2)}` : <span className="mute">excluded</span>}</td></tr>)}
      </tbody></table><p className="total">Total: ${cart.totalUSD}</p>
      {cart.lines.some(l => l.status !== "ok") && <p className="mute">Flagged items are excluded from the total and are not substituted.</p>}</section>}

    {cart && !stale && <section className={`card ${confirmed ? "done" : ""}`}><div className="step">Step 4</div><h2>Pharmacist confirmation</h2>
      <p className="mute">A pharmacist reviews the cart. The PIN is checked <b>on the server</b> before any PayPal order can be created, including by the AI agent.</p>
      <div className="row"><input type="password" placeholder="Pharmacist PIN" value={pin} onChange={e => { setPin(e.target.value); setConfirmed(false); }} />
        {cfg?.paypal === "mock" && cfg?.demoPin && <button className="ghost" disabled={!!busy} title="Mock mode only. Fills the PIN without showing it."
          onClick={() => run("Loading demo PIN…", async () => { const r = await fetch("/api/pharmacist/demo-pin", { cache: "no-store" }); if (!r.ok) throw new Error("Demo PIN not available"); setPin((await r.json()).pin); setConfirmed(false); })}>Use demo PIN</button>}
        <button disabled={!pin || !!busy || Number(cart.totalUSD) <= 0} onClick={() => run("Checking PIN…", async () => { await post("/api/pharmacist/verify", { pin }); setConfirmed(true); })}>Confirm cart</button>
        {confirmed && <span className="ok">✓ PIN verified by the server (re-checked at order creation)</span>}</div></section>}

    {cart && !stale && <section className="card"><div className="step">Step 5</div><h2>Pay</h2>
      <div className="row tabs"><button className={mode === "guided" ? "" : "ghost"} onClick={() => setMode("guided")}>PayPal button</button>
        <button className={mode === "agent" ? "" : "ghost"} onClick={() => setMode("agent")}>🤖 AI agent (PayPal Agent Toolkit)</button></div>

      {mode === "agent" && <>
        <p className="mute">The agent calls <code>build_cart</code>, then <code>create_paypal_order</code> (PayPal Agent Toolkit <code>create_order</code>, behind the server-side pharmacist gate). It controls no prices.</p>
        <button disabled={!!busy || okItems().length === 0} onClick={() => run("Agent working…", async () => { const r = await post("/api/agent", { items: okItems(), pharmacistPin: confirmed ? pin : "", cartHash: cart?.cartHash }); setAgent(r); const o = [...r.trace].reverse().find((t: any) => t.tool === "create_paypal_order")?.output; if (o?.id && r.approval) keepOrder({ ...o, approvalToken: r.approval.approvalToken }); })}>{busy === "Agent working…" ? busy : "Run agent"}</button>
        {agent && <><p><b>Agent:</b> {agent.text}</p><pre className="trace">{agent.trace.map((t: any) => `▶ ${t.tool}\n${JSON.stringify(t.output, null, 1).slice(0, 600)}`).join("\n\n")}</pre></>}
        {order?.id && !receipt && cfg && (cfg.paypal === "mock" ? <button onClick={() => capture(order.id)}>Approve & capture (mock sandbox)</button>
          : <div className="row">
              {approveLink(order)
                ? <a className="btn" href={approveLink(order)} rel="noopener noreferrer" onClick={e => { e.preventDefault(); try { goApprove(order); } catch (x: any) { setErr(x.message); } }}>Approve order {order.id} on PayPal (sandbox) →</a>
                : <span className="mute">Sandbox order {order.id} created, but PayPal returned no approve link.</span>}
              <button className="ghost" disabled={!!busy} onClick={() => capture(order.id)}>I approved it: capture</button></div>)}
      </>}

      {mode === "guided" && (!confirmed ? <p className="mute">Confirm the cart first.</p> :
        !cfg ? <p className="mute">{cfgFailed ? "Payment settings unavailable. Reload the page." : "Loading payment settings…"}</p> :
        cfg.paypal === "mock"
          ? <button disabled={!!busy} onClick={() => run("Paying…", async () => { const o = await post("/api/paypal/create-order", { items: okItems(), pharmacistPin: pin, cartHash: cart?.cartHash }); keepOrder(o); setReceipt(await post("/api/paypal/capture-order", { orderID: o.id, approvalToken: o.approvalToken, items: okItems() })); })}>Pay with PayPal (mock sandbox)</button>
          : receipt ? null : <>
            {clientId && <PayPalSdkButtons clientId={clientId}
              createOrder={async () => { setErr(""); try { const o = await post("/api/paypal/create-order", { items: okItems(), pharmacistPin: pin, cartHash: cart?.cartHash }); keepOrder(o); return o.id; } catch (e: any) { setErr(e.message); if (/Pharmacist|Cart changed/.test(e.message)) setConfirmed(false); throw e; } }}
              onApprove={async id => capture(id)} onCancel={() => setErr("PayPal payment cancelled. Nothing was charged.")} onError={m => setErr(m)} />}
            <p className="mute">{clientId ? "Or, if the popup is blocked:" : "PayPal Buttons need a sandbox client ID from /api/config."}</p>
            <button className={clientId ? "ghost" : ""} disabled={!!busy} onClick={() => run("Creating PayPal order…", async () => { const o = await post("/api/paypal/create-order", { items: okItems(), pharmacistPin: pin, cartHash: cart?.cartHash }); keepOrder(o); goApprove(o); })}>Pay with PayPal (sandbox, redirect)</button>
          </>)}
    </section>}

    {receipt && <section className="card done"><div className="step">Step 6</div><h2>✅ Receipt</h2>
      <p>Status: <b>{receipt.status}</b> · Order <code>{receipt.id}</code>{receipt.mock && <span className="badge mock">mock</span>}</p>
      <p>Paid: <b>${receipt.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? cart?.totalUSD}</b> (sandbox, no real money)</p>
      <p className="mute">Flagged items were not charged and were not substituted.</p></section>}

  </main>;
}
