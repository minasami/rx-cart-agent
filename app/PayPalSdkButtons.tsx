"use client";
import { useEffect, useRef, useState } from "react";
import { loadPayPalSdk, paypalSdkUrl } from "@/lib/paypalSdk";

type Props = {
  clientId: string;
  /** Must return a PayPal order id created by OUR server (PIN + cartHash checked there). */
  createOrder: () => Promise<string>;
  onApprove: (orderID: string) => Promise<void>;
  onCancel?: () => void;
  onError: (message: string) => void;
};

/** PayPal JS SDK Buttons (popup flow). The SDK script is injected at runtime from the client ID that
 *  /api/config serves, so no build-time NEXT_PUBLIC_ variable is needed. Callbacks are read through a ref,
 *  so the rendered buttons always see the current cart / approval token. */
export function PayPalSdkButtons(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(props); cb.current = props;
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let alive = true; let buttons: any; setState("loading");
    let createFailed = false; // our create-order error is already shown; skip PayPal's generic follow-up onError
    let url: string;
    try { url = paypalSdkUrl(props.clientId); } catch (e: any) { setState("failed"); cb.current.onError(e.message); return; }
    loadPayPalSdk(url).then(async (paypal: any) => {
      if (!alive || !box.current) return;
      buttons = paypal.Buttons({
        style: { layout: "vertical", label: "pay", shape: "rect" },
        createOrder: async () => { createFailed = false; try { return await cb.current.createOrder(); } catch (e) { createFailed = true; throw e; } },
        onApprove: async (d: { orderID?: string }) => { if (d.orderID) await cb.current.onApprove(d.orderID); },
        onCancel: () => cb.current.onCancel?.(),
        onError: (e: unknown) => { if (createFailed) { createFailed = false; return; } cb.current.onError(`PayPal: ${(e as any)?.message ?? String(e)}`); },
      });
      if (typeof buttons.isEligible === "function" && !buttons.isEligible()) throw new Error("PayPal Buttons are not eligible in this browser");
      await buttons.render(box.current);
      if (alive) setState("ready");
    }).catch((e: any) => { if (alive) { setState("failed"); cb.current.onError(`${e?.message ?? e}. Use the redirect button instead.`); } });
    return () => { alive = false; try { buttons?.close?.()?.catch?.(() => {}); } catch { /* already gone */ } };
  }, [props.clientId]);
  return <div className="paypal-sdk" aria-busy={state === "loading"}>
    {state === "loading" && <p className="mute"><span className="spin" aria-hidden="true" /> Loading PayPal…</p>}
    {state === "failed" && <p className="warn">PayPal Buttons unavailable. Use the redirect button below.</p>}
    <div ref={box} />
  </div>;
}
