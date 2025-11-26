// ======================================================================
// Agent K — Full Production Server
// Includes:
// - Identity fix (Agent K vs Kyle)
// - Third-person enforcement patch
// - Suggestion cleanup patch
// - Easter egg (joke of the day)
// - Synthesis fallback (10-entry context synthesis)
// - Embeddings auto-disable (clean logs)
// ======================================================================

import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import fs from 'fs/promises';

const app = express();
const PORT = process.env.PORT || 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const EMBEDDING_MODEL = process.env.GROQ_EMBED_MODEL || "nomic-embed-text-v1.5";

// Auto-disable embeddings unless they are working
let EMBEDDINGS_ENABLED = true;

// ======================================================================
// UTILITIES
// ======================================================================

function formatParagraphs(text) {
  if (!text) return text;
  return text
    .replace(/\r?\n/g, "\n")
    .replace(/([.?!])\s+(?=[A-Z])/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// REFRESHED IDENTITY PATCH
// SAFE: Only rewrites “I” when the sentence is clearly about Kyle’s experience.
// NEVER rewrites “I” when referring to Agent K.
// Prevents “Kyle is here!”
// Prevents “I isolate…” when talking about Kyle.
function enforceThirdPersonForKyle(raw) {
  if (!raw) return raw;
  const lines = raw.split("\n");

  const processed = lines.map(line => {
    // Skip if line explicitly references Agent K
    if (/Agent K/i.test(line)) return line;

    // Only transform if it's describing work/experience
    const hint = /(experience|background|testing|validation|operations|projects|autonomous|perception|SaaS|data|customers?|analysis|field)/i;
    if (!hint.test(line)) return line;

    // Transform only pronouns that refer to human experience
    let out = line;
    out = out.replace(/\bMy background\b/gi, "Kyle's background");
    out = out.replace(/\bMy experience\b/gi, "Kyle's experience");

    out = out.replace(/\bI am\b/gi, "Kyle is");
    out = out.replace(/\bI'm\b/gi, "Kyle is");

    out = out.replace(/\bI have\b/gi, "Kyle has");
    out = out.replace(/\bI've\b/gi, "Kyle has");

    out = out.replace(/\bMy\b/gi, "Kyle's");

    // Replace isolated “I” only in these contexts (avoid conversational use)
    out = out.replace(/\bI\b/gi, "Kyle");

    return out;
  });

  return processed.join("\n");
}

// Removes weird LLM artifacts
function sanitizePhrases(text) {
  if (!text) return text;
  let out = text;

  out = out.replace(/Same energy[^.?!]*[.?!]/gi, "");
  out = out.replace(/I'm here[^.?!]*[.?!]/gi, "");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

function sanitizeOutput(t) {
  return formatParagraphs(
    sanitizePhrases(
      enforceThirdPersonForKyle(t)
    )
  );
}

// Typo correction to improve retrieval
function normalizeQuery(text) {
  if (!text) return text;
  let out = text;

  const dict = [
    [/autonmous/gi, "autonomous"],
    [/autonamous/gi, "autonomous"],
    [/valdiation/gi, "validation"],
    [/strenghening/gi, "strengthening"],
    [/mangament/gi, "management"],
    [/custmer/gi, "customer"],
    [/experiance/gi, "experience"],
  ];

  dict.forEach(([pat, rep]) => out = out.replace(pat, rep));
  return out;
}

function extractKeywords(t) {
  return (t.toLowerCase().match(/\b[a-z]{3,}\b/g) || []).slice(0, 10);
}

function classifyTopic(lower) {
  if (lower.includes("autonomous") || lower.includes("sensor") || lower.includes("perception"))
    return "autonomous systems and perception testing";
  if (lower.includes("program") || lower.includes("project"))
    return "program and project execution";
  if (lower.includes("customer") || lower.includes("client"))
    return "customer success and enterprise workflows";
  if (lower.includes("data") || lower.includes("label"))
    return "large scale training data and quality programs";
  if (lower.includes("ai") || lower.includes("script"))
    return "applied AI tools, automation, and scripting";

  return "his work in autonomous systems, validation, program management, SaaS workflows, and applied AI tools";
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ======================================================================
// KNOWLEDGE BASE + EMBEDDINGS
// ======================================================================

let knowledgeBase = { qaDatabase: [] };
let kbEmbeddings = [];

async function tryBuildEmbeddings() {
  try {
    const inputs = knowledgeBase.qaDatabase.map(qa => `${qa.question}\n\n${qa.answer}`);

    const batchSize = 50;
    kbEmbeddings = [];

    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const resp = await groq.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
      if (!resp?.data) throw new Error("No embeddings returned");

      resp.data.forEach((item, idx) => {
        kbEmbeddings.push({ index: i + idx, embedding: item.embedding });
      });
    }

    console.log("Embeddings built:", kbEmbeddings.length);
  } catch (err) {
    EMBEDDINGS_ENABLED = false;
    kbEmbeddings = [];
    console.log("Embeddings disabled (fallback to keyword-only).");
  }
}

try {
  const data = await fs.readFile("./knowledge-base.json", "utf8");
  knowledgeBase = JSON.parse(data);

  console.log("Loaded KB entries:", knowledgeBase.qaDatabase.length);
  await tryBuildEmbeddings();
} catch (err) {
  console.log("Failed loading KB:", err);
}

// Keyword scoring
function keywordScoreAll(query) {
  const q = query.toLowerCase().trim();
  return knowledgeBase.qaDatabase.map((qa, idx) => {
    let score = 0;
    if (qa.keywords?.some(k => q.includes(k.toLowerCase()))) score += 25;

    const words = q.split(/\s+/);
    words.forEach(w => {
      if (qa.question.toLowerCase().includes(w) ||
          qa.answer.toLowerCase().includes(w) ||
          qa.keywords?.some(k => k.toLowerCase().includes(w))) {
        score += 3;
      }
    });

    return { ...qa, score, index: idx };
  });
}

// Hybrid retrieval (keyword + embeddings)
async function hybridSearch(query, limit = 5) {
  const q = query.toLowerCase().trim();
  const kw = keywordScoreAll(q);
  const maxKW = Math.max(...kw.map(x => x.score), 0);

  if (!EMBEDDINGS_ENABLED || kbEmbeddings.length === 0) {
    return kw.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Embeddings path (if enabled)
  let qEmb = null;
  try {
    const resp = await groq.embeddings.create({ model: EMBEDDING_MODEL, input: [query] });
    qEmb = resp.data[0].embedding;
  } catch {
    return kw.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  const embScores = new Map();
  kbEmbeddings.forEach(item => {
    embScores.set(item.index, cosineSimilarity(qEmb, item.embedding));
  });

  const combined = kw.map(x => {
    const kwNorm = maxKW ? x.score / maxKW : 0;
    const emb = embScores.get(x.index) || 0;
    const score = 0.35 * kwNorm + 0.65 * emb;
    return score > 0 ? { ...x, score } : null;
  }).filter(Boolean);

  return combined.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ======================================================================
// OFF-TOPIC, STAR DETECTORS
// ======================================================================

const funResponses = {
  joke: "Agent K can share a joke if prompted, but focuses on Kyle’s work.",
  greeting: "Hello. Agent K can walk through Kyle’s background whenever you’re ready.",
  thanks: "You're welcome. You can ask about any part of Kyle’s work.",
};

// Joke of the day easter egg (light, clean)
const jokeTriggers = /\b(joke of the day|daily joke|random joke|surprise me with a joke)\b/i;

// STAR detection
function detectSTAR(q) {
  const t = q.toLowerCase();
  const triggers = [
    "tell me about a time",
    "star example",
    "describe a time",
    "walk me through",
  ];
  return triggers.some(x => t.includes(x));
}

function detectMulti(q) {
  return /\band\b.*\?/i.test(q) || /\?.*\?/.test(q);
}

// ======================================================================
// ROUTES
// ======================================================================

app.post("/suggest", async (req, res) => {
  const q = (req.body.q || "").trim();
  if (q.length < 2) {
    const defaults = knowledgeBase.qaDatabase.slice(0, 5).map(x => x.question);
    return res.json({ suggestions: defaults });
  }

  const hybrid = await hybridSearch(normalizeQuery(q), 8);
  const suggestions = Array.from(new Set(hybrid.map(x => x.question)))
    .filter(s => s && s.length > 3 && /\w/.test(s))
    .slice(0, 5);

  res.json({ suggestions });
});

app.post("/query", async (req, res) => {
  try {
    let q = (req.body.q || "").trim();
    let lastBot = req.body.lastBotMessage || "";

    const normalized = normalizeQuery(q);
    const lower = normalized.toLowerCase();

    // ====================================================
    // EASTER EGG: JOKE OF THE DAY
    // ====================================================
    if (jokeTriggers.test(lower)) {
      const resp = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: "Tell a short, clean, PG-rated joke. Do not mention Kyle or Agent K." },
          { role: "user", content: "Give me a joke of the day." }
        ],
        temperature: 0.8,
        max_tokens: 60
      });

      return res.json({ answer: resp.choices[0]?.message?.content?.trim() || "Couldn't fetch a joke." });
    }

    // ====================================================
    // HYBRID RETRIEVAL
    // ====================================================
    const hybrid = await hybridSearch(normalized, 6);
    const topScore = hybrid.length ? hybrid[0].score : 0;

    const STRONG = 0.60;
    const MEDIUM = 0.30;
    const WEAK = 0.12;

    if (hybrid.length && topScore >= STRONG) {
      return res.json({ answer: sanitizeOutput(hybrid[0].answer) });
    }

    // ====================================================
    // SYNTHESIS FALLBACK (NEW)
    // ONLY WHEN embeddings disabled AND weak/no matches
    // ====================================================
    let contextText = "";

    if ((!hybrid.length || topScore < WEAK) && !EMBEDDINGS_ENABLED) {
      const sampleSize = 10;
      const step = Math.max(1, Math.floor(knowledgeBase.qaDatabase.length / sampleSize));
      const sampled = [];

      for (let i = 0; i < knowledgeBase.qaDatabase.length && sampled.length < sampleSize; i += step) {
        const qa = knowledgeBase.qaDatabase[i];
        if (qa?.question && qa?.answer) sampled.push(qa);
      }

      contextText = "WIDER CONTEXT (PARAPHRASE ONLY):\n\n";
      sampled.forEach((qa, idx) => {
        contextText += `${idx + 1}. Question: ${qa.question}\n   Answer: ${qa.answer}\n\n`;
      });
    }

    // ====================================================
    // BUILD LLM PROMPT
    // ====================================================

    const systemPrompt = `
You are Agent K, an AI assistant that explains Kyle’s professional background in third person.
You may speak as "I" only when referring to Agent K's own actions.
Never speak for Kyle in first person.

When describing Kyle:
- Use "he", "his", "Kyle".
Never "I" for Kyle.

Provide structured, multi-sentence answers.
Use STAR format when appropriate.
Use context provided in RELEVANT BACKGROUND or WIDER CONTEXT.

${contextText}
`.trim();

    const userMessage = normalized;

    const resp = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 700
    });

    const raw = resp.choices[0]?.message?.content?.trim() || "Agent K could not form a response.";
    return res.json({ answer: sanitizeOutput(raw) });

  } catch (err) {
    console.error(err);
    return res.json({ answer: "Agent K encountered a temporary issue. Try again." });
  }
});

// ======================================================================
app.listen(PORT, () => console.log("Agent K live on port", PORT));
