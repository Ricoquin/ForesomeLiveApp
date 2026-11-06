// Supabase Edge Function: stripe-webhook
// Processes Stripe Connect webhook events:
// - payment_intent.succeeded / checkout.session.completed -> confirms registration or order
// - charge.refunded -> records refund & promotes waitlist #1 if a spot opened
// - invoice.payment_succeeded -> records recurring membership dues renewal
// - invoice.payment_failed -> marks membership past_due & queues retry notice in notification_outbox
// - account.updated -> updates stripe_accounts onboarding & payout status

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const event = await req.json();
    const type = event.type;
    const obj = event.data?.object || {};

    if (type === 'payment_intent.succeeded') {
      await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('stripe_payment_intent_id', obj.id);

      if (obj.metadata?.registration_id) {
        await supabase
          .from('registrations')
          .update({ status: 'confirmed', paid_at_course_at: new Date().toISOString() })
          .eq('id', obj.metadata.registration_id);
      }
    } else if (type === 'charge.refunded') {
      const piId = obj.payment_intent;
      const refundedCents = obj.amount_refunded || 0;
      const fullRefund = refundedCents >= (obj.amount || 0);

      const { data: pay } = await supabase
        .from('payments')
        .update({
          refunded_cents: refundedCents,
          status: fullRefund ? 'refunded' : 'partially_refunded',
        })
        .eq('stripe_payment_intent_id', piId)
        .select('*')
        .maybeSingle();

      // If full refund on an event registration, cancel and promote #1 on waitlist
      if (fullRefund && pay?.registration_id) {
        await supabase
          .from('registrations')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('id', pay.registration_id);

        if (pay.event_id) {
          const { data: nextWait } = await supabase
            .from('registrations')
            .select('*')
            .eq('event_id', pay.event_id)
            .eq('status', 'waitlisted')
            .order('waitlist_position', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (nextWait) {
            await supabase
              .from('registrations')
              .update({
                status: 'confirmed',
                waitlist_position: null,
                promoted_at: new Date().toISOString(),
              })
              .eq('id', nextWait.id);

            await supabase.from('notification_outbox').insert([
              {
                profile_id: nextWait.profile_id,
                kind: 'waitlist_promoted',
                payload: { event_id: pay.event_id, registration_id: nextWait.id },
              },
            ]);
          }
        }
      }
    } else if (type === 'invoice.payment_succeeded') {
      const subId = obj.subscription;
      if (subId) {
        const { data: mem } = await supabase
          .from('memberships')
          .select('*')
          .eq('stripe_subscription_id', subId)
          .maybeSingle();
        if (mem) {
          await supabase
            .from('memberships')
            .update({
              status: 'active',
              payment_status: 'active',
              renewal_count: (mem.renewal_count || 0) + 1,
              renewed_at: new Date().toISOString(),
            })
            .eq('id', mem.id);
        }
      }
    } else if (type === 'invoice.payment_failed') {
      const subId = obj.subscription;
      if (subId) {
        const { data: mem } = await supabase
          .from('memberships')
          .select('*')
          .eq('stripe_subscription_id', subId)
          .maybeSingle();
        if (mem) {
          await supabase
            .from('memberships')
            .update({
              status: 'past_due',
              payment_status: 'past_due',
              retry_count: (mem.retry_count || 0) + 1,
            })
            .eq('id', mem.id);

          await supabase.from('notification_outbox').insert([
            {
              profile_id: mem.profile_id,
              kind: 'membership_payment_failed',
              payload: { community_id: mem.community_id, subscription_id: subId },
            },
          ]);
        }
      }
    } else if (type === 'account.updated') {
      const acctId = obj.id;
      const complete = Boolean(obj.details_submitted && obj.charges_enabled);
      await supabase
        .from('stripe_accounts')
        .update({
          charges_enabled: Boolean(obj.charges_enabled),
          payouts_enabled: Boolean(obj.payouts_enabled),
          onboarding_complete: complete,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_account_id', acctId);

      await supabase
        .from('communities')
        .update({ stripe_onboarding_complete: complete })
        .eq('stripe_account_id', acctId);

      await supabase
        .from('organizations')
        .update({ stripe_onboarding_complete: complete })
        .eq('stripe_account_id', acctId);
    }

    return new Response(JSON.stringify({ received: true, type }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

