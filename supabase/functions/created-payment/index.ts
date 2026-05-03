import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tabela de preços oficial
const PRICING: Record<string, Record<number, number>> = {
  claro: { 20: 15, 25: 19, 30: 22, 50: 37, 100: 74 },
  vivo:  { 15: 13, 20: 16, 25: 20, 30: 23, 50: 39, 100: 78 },
  tim:   { 15: 10.5, 20: 14, 25: 17.5, 30: 21, 50: 35, 100: 70 },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { carrier, phone, recharge_amount } = await req.json();

    if (!carrier || !phone || !recharge_amount) {
      return new Response(JSON.stringify({ error: "Dados incompletos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const carrierKey = String(carrier).toLowerCase();
    const amt = Number(recharge_amount);
    const price = PRICING[carrierKey]?.[amt];
    if (!price) {
      return new Response(JSON.stringify({ error: "Combinação operadora/valor inválida" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanPhone = String(phone).replace(/\D/g, "");
    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
      return new Response(JSON.stringify({ error: "Telefone inválido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Cria o pedido primeiro para ter um ID estável
    const { data: order, error: insertErr } = await supabase
      .from("orders")
      .insert({
        carrier: carrierKey,
        phone: cleanPhone,
        recharge_amount: amt,
        paid_amount: price,
        status: "pending",
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    const apiKey = Deno.env.get("PIXGO_API_KEY");
    if (!apiKey) throw new Error("PIXGO_API_KEY não configurada");

    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pixgo-webhook`;

    const carrierName = carrierKey.charAt(0).toUpperCase() + carrierKey.slice(1);
    const description = `Recarga ${carrierName} R$${amt} - ${cleanPhone}`;

    const pixRes = await fetch("https://pixgo.org/api/v1/payment/create", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: price,
        description,
        external_id: order.id,
        webhook_url: webhookUrl,
      }),
    });

    const pixData = await pixRes.json();
    if (!pixRes.ok || !pixData.success) {
      console.error("PixGo error:", pixData);
      await supabase.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      return new Response(JSON.stringify({
        error: pixData.message || "Erro ao gerar pagamento PIX",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const d = pixData.data;
    await supabase.from("orders").update({
      pixgo_payment_id: d.payment_id,
      qr_code: d.qr_code,
      qr_image_url: d.qr_image_url,
      expires_at: d.expires_at,
    }).eq("id", order.id);

    return new Response(JSON.stringify({
      order_id: order.id,
      payment_id: d.payment_id,
      qr_code: d.qr_code,
      qr_image_url: d.qr_image_url,
      amount: price,
      expires_at: d.expires_at,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("create-payment error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
