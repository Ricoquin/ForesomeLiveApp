// ForeSome — AI insight after each round.
// Deploy:  supabase functions deploy player-insight
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Reads the signed-in player's recent rounds, asks Claude for 2–3 short, specific tips,
// and caches the answer so the AI only runs again after a new round is logged.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'claude-haiku-5-5';   // fast and low cost
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const { data: rounds, error } = await asUser.from('rounds')
      .select('course_name, created_at, completed_holes, summary, hole_scores')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    if (!rounds?.length) return json({ insight: null });

    const latest = rounds[0].created_at;
    const { data: cached } = await admin.from('player_insights').select('*').eq('user_id', user.id).maybeSingle();
    if (cached && cached.latest_round_at && new Date(cached.latest_round_at) >= new Date(latest)) {
      return json({ insight: cached.insight, cached: true });
    }

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: 'ANTHROPIC_API_KEY is not set' }, 500);

    const { data: profile } = await asUser.from('profiles').select('handicap').eq('id', user.id).maybeSingle();
    const compact = rounds.map((r) => ({
      date: r.created_at?.slice(0, 10), course: r.course_name, holes: r.completed_holes,
      score: r.summary?.score, putts: r.summary?.putts, gir: r.summary?.gir, fir: r.summary?.fir,
      byHole: Array.isArray(r.hole_scores)
        ? r.hole_scores.map((h: any) => [h.score, h.putts, h.gir ? 1 : 0, h.fir ? 1 : 0, h.pen ? 1 : 0])
        : undefined,
    }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system:
          'You are a friendly, direct golf coach inside the ForeSome app. Using ONLY the round data given, ' +
          'write 2 or 3 short insights (one sentence each, under 25 words) about what is costing this golfer strokes ' +
          'and one concrete thing to practice. Cite real numbers from the data. Never invent stats, courses or trends ' +
          'the data does not show. Plain text, one insight per line, no bullets or headings. ' +
          'byHole entries are [strokes, putts, greenInRegulation, fairwayHit, penalty].',
        messages: [{ role: 'user', content: JSON.stringify({ handicap: profile?.handicap ?? null, rounds: compact }) }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const out = await res.json();
    const insight = (out.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();

    await admin.from('player_insights').upsert({
      user_id: user.id, insight, latest_round_at: latest, rounds_considered: rounds.length, created_at: new Date().toISOString(),
    });
    return json({ insight });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
