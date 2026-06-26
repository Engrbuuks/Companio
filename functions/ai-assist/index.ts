// ============================================================================
// COMPANIO — ai-assist Edge Function (Supabase + Google Gemini 2.5 Flash)
// One endpoint, four AI tasks. DORMANT until you set GEMINI_API_KEY and
// turn on feature.ai in Settings. Every task keeps a human in control:
// the AI drafts/suggests, a person reviews and decides.
//
// Deploy:  supabase functions deploy ai-assist
// Secret:  supabase secrets set GEMINI_API_KEY=AIza...
//   (get a free key at https://aistudio.google.com/apikey — the free tier
//    covers far more than Companio will use at pilot scale.)
//
// Tasks (POST {task, data}):
//   note_draft     — turn a companion's rough notes into a warm family update
//   match_explain  — given a user + candidate companions, rank with reasoning
//   visit_prep     — summarise what a companion should know before a visit
//   enquiry_triage — draft a first reply + urgency flag for a new enquiry
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// 2.5 Flash is the default; override with GEMINI_MODEL if you ever want to change it.
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

const SYSTEM = `You are an assistant inside Companio, a premium UK companionship service for older people ("a friend, not a carer"). You support the human operators and companions — you never make care or safeguarding decisions, you draft and suggest so a person can review. Tone: warm, plain, British, never clinical, never gushing. Never invent medical facts. Keep within what the input supports.`;

// task -> builds the user prompt + caps tokens
function buildPrompt(task: string, d: Record<string, unknown>): { prompt: string; max: number } | null {
  switch (task) {
    case "note_draft":
      return {
        max: 400,
        prompt: `A companion has just finished a visit with ${d.user_name ?? "a client"} and jotted these rough notes:\n\n"${d.rough ?? ""}"\n\nWrite a warm, brief note for the family (2-4 sentences) sharing how the visit went. First person, from the companion. Specific and kind. No medical claims. Just the note - no preamble.`,
      };
    case "match_explain":
      return {
        max: 600,
        prompt: `Service user:\n${JSON.stringify(d.user, null, 2)}\n\nCandidate companions:\n${JSON.stringify(d.candidates, null, 2)}\n\nFor each candidate, give a one-sentence, human reason they would or wouldn't suit this person - looking beyond keywords at temperament and the free-text notes. Return JSON only: [{"companion_id":"...","fit":"strong|good|weak","reason":"..."}], best first. No other text.`,
      };
    case "visit_prep":
      return {
        max: 350,
        prompt: `Here is what we know about ${d.user_name ?? "a client"} and recent visit notes:\n\nProfile: ${d.profile ?? ""}\nRecent notes:\n${d.notes ?? "(none yet)"}\n\nWrite a short "before you go" briefing (3-5 bullet points) for the companion visiting today - things to remember, topics they enjoy, anything to be gentle about. Practical and warm. No medical advice.`,
      };
    case "enquiry_triage":
      return {
        max: 400,
        prompt: `A new enquiry came in:\nName: ${d.name ?? ""}\nMessage: ${d.message ?? ""}\nMatcher notes: ${d.matcher ?? ""}\n\nReturn JSON only: {"urgency":"high|normal|low","why":"one line","draft_reply":"a warm 2-3 sentence first reply a coordinator could send"}. No other text.`,
      };
    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!API_KEY) return new Response(JSON.stringify({ error: "AI not configured (no GEMINI_API_KEY)" }), { status: 503, headers: cors() });

  let body: { task?: string; data?: Record<string, unknown> };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: cors() }); }

  const built = buildPrompt(body.task ?? "", body.data ?? {});
  if (!built) return new Response(JSON.stringify({ error: "unknown task" }), { status: 400, headers: cors() });

  // these two tasks must return clean JSON — use Gemini's JSON mode so we don't
  // have to strip markdown fences the model might otherwise add.
  const wantsJson = body.task === "match_explain" || body.task === "enquiry_triage";

  try {
    // Gemini generateContent endpoint. The key goes in the query string.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
    const genConfig: Record<string, unknown> = { maxOutputTokens: built.max, temperature: 0.7 };
    if (wantsJson) genConfig.responseMimeType = "application/json";
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // Gemini has no separate "system" param on this endpoint; use systemInstruction.
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: built.prompt }] }],
        generationConfig: genConfig,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: j.error?.message ?? "AI request failed" }), { status: r.status, headers: cors() });
    }
    // Gemini response shape: candidates[0].content.parts[].text
    const text = (j.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      const reason = j.candidates?.[0]?.finishReason ?? "no content";
      return new Response(JSON.stringify({ error: `No text returned (${reason})` }), { status: 502, headers: cors() });
    }
    return new Response(JSON.stringify({ result: text }), { status: 200, headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors() });
  }
});

function cors() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
}
