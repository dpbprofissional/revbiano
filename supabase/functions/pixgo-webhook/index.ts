import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const STATUS_MAP: Record<string, string> = {
  "payment.completed": "completed",
  "payment.expired": "expired",
  "payment.refunded": "refunded",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
    const signature = req.headers.get("x-webhook-signature") ?? "";
    const secret = Deno.env.get("PIXGO_WEBHOOK_SECRET");

    if (!secret) throw new Error("PIXGO_WEBHOOK_SECRET não configurada");

    if (!timestamp || !signature) {
      return new Response("Missing signature headers", { status: 401 });
    }

    const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
    if (!timingSafeEqualHex(expected, signature)) {
      console.warn("Invalid signature");
      return new Response("Invalid signature", { status: 401 });
    }

    // Anti replay (5min)
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) {
      return new Response("Timestamp expired", { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event as string;
    const data = payload.data;
    const newStatus = STATUS_MAP[event];
    if (!newStatus || !data?.payment_id) {
      return new Response("ok", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const update: Record<string, unknown> = { status: newStatus };
    if (newStatus === "completed") update.paid_at = new Date().toISOString();

    const { error } = await supabase
      .from("orders")
      .update(update)
      .eq("pixgo_payment_id", data.payment_id);

    if (error) console.error("DB update error:", error);

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("webhook error:", err);
    return new Response("error", { status: 500 });
  }
});
