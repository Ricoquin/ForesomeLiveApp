// Supabase Edge Function: create-checkout
// Creates a Stripe Connect Checkout Session or PaymentIntent with destination transfer
// and applies ForeSome's all-in transaction fee (5–6% on Pro/Partner, 6–7% on Free),
// either absorbed by the payee or passed to the player as a visible line item.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

    const body = await req.json();
    const {
      subtotal_cents = 0,
      pass_fee_to_player = false,
      plan_tier = 'free', // 'free' (6.5% all-in) | 'pro' (5.5% all-in) | 'operator' (5.5% all-in)
      destination_account_id,
      customer_id,
      save_payment_method = true,
      metadata = {},
    } = body;

    // ForeSome Pricing & Revenue Model:
    // Pro / Operator: 5.5% all-in (covers Stripe 2.9% + $0.30 + ForeSome platform share)
    // Free: 6.5% all-in
    const allInBps = plan_tier === 'pro' || plan_tier === 'operator' ? 550 : 650;
    const allInFeeCents = subtotal_cents > 0 ? Math.round((subtotal_cents * allInBps) / 10000) + 30 : 0;
    const stripeProcessingCents = subtotal_cents > 0 ? Math.round(subtotal_cents * 0.029) + 30 : 0;
    const platformFeeCents = Math.max(0, allInFeeCents - stripeProcessingCents);

    const totalChargedCents = pass_fee_to_player ? subtotal_cents + allInFeeCents : subtotal_cents;
    const netPayeeCents = pass_fee_to_player
      ? subtotal_cents
      : Math.max(0, subtotal_cents - allInFeeCents);

    if (!stripeSecret) {
      return new Response(
        JSON.stringify({
          mode: 'demo',
          payment_intent_id: `pi_fs_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
          client_secret: `pi_demo_secret_${Date.now()}`,
          subtotal_cents,
          all_in_fee_cents: allInFeeCents,
          processing_fee_cents: stripeProcessingCents,
          platform_fee_cents: platformFeeCents,
          total_cents: totalChargedCents,
          net_payee_cents: netPayeeCents,
          status: 'succeeded',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const params = new URLSearchParams({
      amount: String(totalChargedCents),
      currency: 'usd',
      'automatic_payment_methods[enabled]': 'true',
    });

    if (customer_id) params.set('customer', customer_id);
    if (save_payment_method) params.set('setup_future_usage', 'off_session');
    if (destination_account_id) {
      params.set('application_fee_amount', String(allInFeeCents));
      params.set('transfer_data[destination]', destination_account_id);
    }
    Object.entries(metadata).forEach(([k, v]) => {
      if (v != null) params.set(`metadata[${k}]`, String(v));
    });

    const piRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const pi = await piRes.json();

    if (supabase && pi.id) {
      await supabase.from('payments').insert([
        {
          profile_id: metadata.profile_id || null,
          community_id: metadata.community_id || null,
          organization_id: metadata.organization_id || null,
          event_id: metadata.event_id || null,
          kind: metadata.kind || 'event_entry',
          subtotal_cents,
          processing_fee_cents: stripeProcessingCents,
          platform_fee_cents: platformFeeCents,
          total_cents: totalChargedCents,
          net_organizer_cents: netPayeeCents,
          stripe_payment_intent_id: pi.id,
          status: 'pending',
        },
      ]);
    }

    return new Response(
      JSON.stringify({
        mode: 'live',
        payment_intent_id: pi.id,
        client_secret: pi.client_secret,
        subtotal_cents,
        all_in_fee_cents: allInFeeCents,
        processing_fee_cents: stripeProcessingCents,
        platform_fee_cents: platformFeeCents,
        total_cents: totalChargedCents,
        net_payee_cents: netPayeeCents,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

