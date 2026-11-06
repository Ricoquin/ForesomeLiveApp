// Supabase Edge Function: notify
// Dispatches announcements and automated reminders across Email, SMS, and Push / In-App Outbox.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { announcementId, communityId, eventId, title, body, channels } = await req.json();

    let recipientIds: string[] = [];
    if (eventId) {
      const { data: regs } = await supabase
        .from("registrations")
        .select("profile_id")
        .eq("event_id", eventId)
        .in("status", ["confirmed", "checked_in", "waitlisted"]);
      recipientIds = [...new Set((regs || []).map((r: { profile_id: string }) => r.profile_id))];
    } else if (communityId) {
      const { data: mems } = await supabase
        .from("memberships")
        .select("profile_id")
        .eq("community_id", communityId)
        .eq("status", "active");
      recipientIds = [...new Set((mems || []).map((m: { profile_id: string }) => m.profile_id))];
    }

    if (recipientIds.length > 0) {
      const outboxRows = recipientIds.map((pid) => ({
        profile_id: pid,
        kind: "announcement",
        payload: { title, body, channels, community_id: communityId, event_id: eventId },
      }));
      await supabase.from("notification_outbox").insert(outboxRows);
    }

    if (resendKey && channels?.includes("email")) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("email")
        .in("id", recipientIds)
        .not("email", "is", null);
      for (const p of profs || []) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "ForeSome <notifications@foresomekc.com>",
            to: [p.email],
            subject: title,
            text: body,
          }),
        }).catch(() => null);
      }
    }

    if (announcementId) {
      await supabase
        .from("community_announcements")
        .update({ sent_at: new Date().toISOString(), recipient_cnt: recipientIds.length })
        .eq("id", announcementId);
    }

    return new Response(
      JSON.stringify({ sent: true, recipients: recipientIds.length, channels }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

