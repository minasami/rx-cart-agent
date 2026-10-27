"use client";
import { useEffect, useState } from "react";
import { captureBody, clearPending, loadPending, parseReturn, type Pending } from "@/lib/pending";

/** PayPal return_url / cancel_url target: /return?token=<order id>&PayerID=... (or &cancelled=1). */
export default function ReturnPage() {
  const [ret, setRet] = useState<ReturnType<typeof parseReturn>>();
  const [pending, setPending] = useState<Pending>();
  const [receipt, setReceipt] = useState<any>(); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const r = parseReturn(window.location.search); setRet(r);
    if (r.cancelled) { if (loadPending(sessionStorage, r.orderID)) clearPending(sessionStorage); return; }
    setPending(loadPending(sessionStorage, r.orderID));
  }, []);
  const capture = async () => {
    if (!pending) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/paypal/capture-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(captureBody(pending)) });
      let j: any = null; try { j = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok || !j || j.error) { if (res.status === 409 || res.status === 403) clearPending(sessionStorage); throw new Error(j?.error ?? `${res.status} ${res.statusText}`); }
      clearPending(sessionStorage); setReceipt(j);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return <main>
    <header><h1>💊 Rx Cart Agent</h1></header>
    <div className="banner">⚠️ <b>Synthetic demo.</b> PayPal <b>sandbox</b> only, no real money.</div>
    {err && <div className="toasts"><div className="toast error" role="alert"><span>⚠️ {err}</span><button className="ghost" aria-label="Dismiss error" onClick={() => setErr("")}>✕</button></div></div>}
    {!ret ? <section className="card"><p className="mute">Loading…</p></section>
    : ret.cancelled ? <section className="card"><h2>Payment cancelled</h2><p>Nothing was charged{ret.orderID && <> for order <code>{ret.orderID}</code></>}.</p><a className="btn" href="/">Back to the cart</a></section>
    : !ret.orderID ? <section className="card"><h2>No PayPal order</h2><p className="mute">This page is where PayPal returns after approval (<code>?token=ORDER_ID</code>).</p><a className="btn" href="/">Back to the cart</a></section>
    : receipt ? <section className="card done"><div className="step">Done</div><h2>✅ Payment captured</h2>
        <p>Status: <b>{receipt.status}</b> · Order <code>{receipt.id}</code></p>
        <p>Paid: <b>${receipt.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? pending?.totalUSD}</b> (sandbox, no real money)</p>
        <a className="btn" href="/">New order</a></section>
    : <section className="card"><div className="step">Step 6</div><h2>Capture payment</h2>
        <p>PayPal order <code>{ret.orderID}</code> was approved by the buyer{ret.payerID && <> (payer <code>{ret.payerID}</code>)</>}.</p>
        {pending ? <>
          <p className="mute">Capture uses the server-signed approval held in this tab for this order and cart{pending.totalUSD && <> (${pending.totalUSD})</>}.</p>
          <button disabled={busy} onClick={capture}>{busy ? "Capturing…" : "Capture payment"}</button></>
        : <p className="mute">This tab has no capture approval for this order (it was created in another tab or origin, or it expired).
            Capture it from the session that created it: <code>POST /api/paypal/capture-order</code> with <code>{"{orderID, approvalToken, items}"}</code>.</p>}
      </section>}
  </main>;
}
