// agent.js - Agent K (100 percent hardened + hybrid embeddings)

// ======================================================================
// IMPORTS AND SETUP
// ======================================================================

import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import fs from 'fs/promises';

const app = express();
const PORT = process.env.PORT || 3000;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json());

// Embedding model for semantic search
const EMBEDDING_MODEL = 'nomic-embed-text-v1.5';

// ======================================================================
// UTILITIES
// ======================================================================

// Enforce readable paragraphs
function formatParagraphs(text) {
  if (!text) return text;
  return text
    .replace(/\r\n/g, '\n')
    .replace(/([.?!])\s+(?=[A-Z])/g, '$1\n') // break sentences to new lines
    .replace(/\n{3,}/g, '\n\n')              // compress excessive breaks
    .trim();
}

// Hard enforcement of third person: rewrite any first-person pronouns
function enforceThirdPerson(text) {
  if (!text) return text;
  let out = text;

  // Specific contracted / common patterns first (case-insensitive)
  out = out.replace(/\bI['’]m\b/gi, 'He is');
  out = out.replace(/\bI\s+am\b/gi, 'He is');
  out = out.replace(/\bI['’]ve\b/gi, 'He has');
  out = out.replace(/\bI\s+have\b/gi, 'He has');
  out = out.replace(/\bI['’]d\b/gi, 'He would');
  out = out.replace(/\bI\s+would\b/gi, 'He would');
  out = out.replace(/\bI\s+was\b/gi, 'He was');
  out = out.replace(/\bI\s+did\b/gi, 'He did');
  out = out.replace(/\bI\s+can\b/gi, 'He can');
  out = out.replace(/\bI\s+will\b/gi, 'He will');
  out = out.replace(/\bI\s+worked\b/gi, 'He worked');
  out = out.replace(/\bI\s+led\b/gi, 'He led');
  out = out.replace(/\bI\s+built\b/gi, 'He built');

  // Generic pronouns (case-insensitive, word boundaries)
  out = out.replace(/\bI\b/gi, 'He');
  out = out.replace(/\bme\b/gi, 'him');
  out = out.replace(/\bmy\b/gi, 'his');
  out = out.replace(/\bmine\b/gi, 'his');
  out = out.replace(/\bmyself\b/gi, 'himself');

  return out;
}

// Light typo normalization
function normalizeQuery(text) {
  if (!text) return text;
  let fixed = text;

  const replacements = [
    { pattern: /\bautonmous\b/gi, repl: 'autonomous' },
    { pattern: /\bautonnomous\b/gi, repl: 'autonomous' },
    { pattern: /\bautonamous\b/gi, repl: 'autonomous' },
    { pattern: /\bautonmoy\b/gi, repl: 'autonomy' },
    { pattern: /\bautopliot\b/gi, repl: 'autopilot' },
    { pattern: /\bvaldiation\b/gi, repl: 'validation' },
    { pattern: /\bvalidaton\b/gi, repl: 'validation' },
    { pattern: /\bvalidaiton\b/gi, repl: 'validation' },
    { pattern: /\bvlaidation\b/gi, repl: 'validation' },
    { pattern: /\bstrenghening\b/gi, repl: 'strengthening' },
    { pattern: /\bstrenghtening\b/gi, repl: 'strengthening' },
    { pattern: /\bstrenthening\b/gi, repl: 'strengthening' },
    { pattern: /\bscrpting\b/gi, repl: 'scripting' },
    { pattern: /\bscriptting\b/gi, repl: 'scripting' },
    { pattern: /\bskritping\b/gi, repl: 'scripting' },
    { pattern: /\bskripting\b/gi, repl: 'scripting' },
    { pattern: /\bprogarm\b/gi, repl: 'program' },
    { pattern: /\bproram\b/gi, repl: 'program' },
    { pattern: /\bprogramm\b/gi, repl: 'program' },
    { pattern: /\bpogram\b/gi, repl: 'program' },
    { pattern: /\bmangament\b/gi, repl: 'management' },
    { pattern: /\bmangement\b/gi, repl: 'management' },
    { pattern: /\bmanagment\b/gi, repl: 'management' },
    { pattern: /\boperatons\b/gi, repl: 'operations' },
    { pattern: /\bperseption\b/gi, repl: 'perception' },
    { pattern: /\bpercpetion\b/gi, repl: 'perception' },
    { pattern: /\bperceptionn\b/gi, repl: 'perception' },
    { pattern: /\bcustmer\b/gi, repl: 'customer' },
    { pattern: /\bcusotmer\b/gi, repl: 'customer' },
    { pattern: /\bsucess\b/gi, repl: 'success' },
    { pattern: /\bsucces\b/gi, repl: 'success' },
    { pattern: /\bexpereince\b/gi, repl: 'experience' },
    { pattern: /\bexperiance\b/gi, repl: 'experience' },
    { pattern: /\bexperinece\b/gi, repl: 'experience' },
    { pattern: /\bdataa\b/gi, repl: 'data' }
  ];

  for (const { pattern, repl } of replacements) {
    fixed = fixed.replace(pattern, repl);
  }

  return fixed;
}

// Extract simple keywords from a string
function extractKeywords(text) {
  return (text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []).slice(0, 10);
}

// Basic topic classification for context hints
function classifyTopic(lower) {
  if (lower.includes('autonomous') || lower.includes('autopilot') || lower.includes('perception') || lower.includes('sensor')) {
    return 'autonomous systems and perception testing';
  }
  if (lower.includes('program') || lower.includes('project') || lower.includes('execution') || lower.includes('roadmap')) {
    return 'program and project execution';
  }
  if (lower.includes('customer') || lower.includes('client') || lower.includes('success') || lower.includes('account')) {
    return 'customer success and client-facing work';
  }
  if (lower.includes('data') || lower.includes('label') || lower.includes('annotation') || lower.includes('training data')) {
    return 'large scale training data and data quality programs';
  }
  if (lower.includes('ai') || lower.includes('agent') || lower.includes('script') || lower.includes('node') || lower.includes('express')) {
    return 'applied AI tools and scripting';
  }
  return 'his work in autonomous systems, validation, program management, SaaS workflows, and applied AI tools';
}

// Cosine similarity for embeddings
function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ======================================================================
// KNOWLEDGE BASE AND EMBEDDINGS
// ======================================================================

let knowledgeBase = { qaDatabase: [] };
let kbEmbeddings = []; // { index, embedding }

async function buildKnowledgeBaseEmbeddings() {
  try {
    if (!knowledgeBase.qaDatabase || knowledgeBase.qaDatabase.length === 0) {
      console.log('No KB entries, skipping embeddings');
      return;
    }

    const inputs = knowledgeBase.qaDatabase.map(qa => {
      const q = qa.question || '';
      const a = qa.answer || '';
      return `${q}\n\n${a}`;
    });

    const batchSize = 50;
    kbEmbeddings = [];

    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const embResp = await groq.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch
      });

      if (embResp && Array.isArray(embResp.data)) {
        embResp.data.forEach((item, idx) => {
          kbEmbeddings.push({
            index: i + idx,
            embedding: item.embedding
          });
        });
      }
    }

    console.log(`Built embeddings for ${kbEmbeddings.length} KB entries`);
  } catch (err) {
    console.error('Failed to build KB embeddings:', err);
  }
}

try {
  const data = await fs.readFile('./knowledge-base.json', 'utf8');
  knowledgeBase = JSON.parse(data);
  console.log(`Loaded ${knowledgeBase.qaDatabase.length} Q&A entries`);

  // Build semantic embeddings once at startup
  await buildKnowledgeBaseEmbeddings();
} catch (err) {
  console.error('Failed to load knowledge base:', err);
}

// Basic scoring search over qaDatabase (keyword based)
function searchKnowledgeBaseKeyword(query, limit = 5) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const scored = knowledgeBase.qaDatabase.map((qa, idx) => {
    let score = 0;
    const keywordHit = qa.keywords.some(k => q.includes(k.toLowerCase()));
    if (keywordHit) score += 25;

    if (qa.question && qa.question.length >= 20) {
      if (q.includes(qa.question.toLowerCase().substring(0, 20))) score += 10;
    }

    const words = q.split(/\s+/).filter(w => w.length > 2);
    words.forEach(word => {
      if (
        qa.question.toLowerCase().includes(word) ||
        qa.answer.toLowerCase().includes(word) ||
        qa.keywords.some(k => k.toLowerCase().includes(word))
      ) {
        score += 3;
      }
    });

    return { ...qa, score, index: idx };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Hybrid search: keyword + embeddings
async function hybridSearchKnowledgeBase(query, limit = 5) {
  const q = query.toLowerCase().trim();
  if (!q || !knowledgeBase.qaDatabase || knowledgeBase.qaDatabase.length === 0) return [];

  // 1) Keyword scores over full KB (for normalization)
  const keywordScoredFull = knowledgeBase.qaDatabase.map((qa, idx) => {
    let score = 0;
    const keywordHit = qa.keywords.some(k => q.includes(k.toLowerCase()));
    if (keywordHit) score += 25;

    if (qa.question && qa.question.length >= 20) {
      if (q.includes(qa.question.toLowerCase().substring(0, 20))) score += 10;
    }

    const words = q.split(/\s+/).filter(w => w.length > 2);
    words.forEach(word => {
      if (
        qa.question.toLowerCase().includes(word) ||
        qa.answer.toLowerCase().includes(word) ||
        qa.keywords.some(k => k.toLowerCase().includes(word))
      ) {
        score += 3;
      }
    });

    return { ...qa, score, index: idx };
  });

  const maxKeywordScore = keywordScoredFull.reduce((max, item) => Math.max(max, item.score), 0);

  // If no embeddings are available, fall back to keyword only
  if (!kbEmbeddings || kbEmbeddings.length === 0) {
    return keywordScoredFull
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // 2) Compute query embedding
  let queryEmbedding = null;
  try {
    const embResp = await groq.embeddings.create({
      model: EMBEDDING_MODEL,
      input: [query]
    });
    if (embResp && Array.isArray(embResp.data) && embResp.data[0]) {
      queryEmbedding = embResp.data[0].embedding;
    }
  } catch (err) {
    console.error('Error creating query embedding:', err);
  }

  if (!queryEmbedding) {
    // Fallback to keyword only
    return keywordScoredFull
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // 3) Embedding similarities
  const embeddingScores = new Map(); // index -> sim
  kbEmbeddings.forEach(item => {
    const sim = cosineSimilarity(queryEmbedding, item.embedding);
    if (sim > 0) {
      embeddingScores.set(item.index, sim);
    }
  });

  if (embeddingScores.size === 0) {
    return keywordScoredFull
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // 4) Combine scores: weighted sum of normalized keyword score and embedding sim
  const combined = [];
  const keywordWeight = 0.35;
  const embedWeight = 0.65;

  for (let idx = 0; idx < knowledgeBase.qaDatabase.length; idx++) {
    const kwItem = keywordScoredFull[idx];
    const kwScore = kwItem.score;
    const kwNorm = maxKeywordScore > 0 ? kwScore / maxKeywordScore : 0;
    const embSim = embeddingScores.get(idx) || 0;
    const combinedScore = keywordWeight * kwNorm + embedWeight * embSim;

    if (combinedScore > 0) {
      combined.push({
        ...kwItem,
        score: combinedScore
      });
    }
  }

  combined.sort((a, b) => b.score - a.score);
  return combined.slice(0, limit);
}

// ======================================================================
// LIGHT OFF-TOPIC RESPONSES (STRICTLY PROFESSIONAL, NO "I")
// ======================================================================

const funResponses = {
  joke: [
    "This assistant focuses on Kyle's professional background. If you share what you are interested in, it can walk through his experience."
  ],
  greeting: [
    "Hello. This assistant can walk through Kyle’s background across autonomous systems, validation, structured testing, program execution, SaaS workflows, and applied AI tools. What would you like to explore?"
  ],
  thanks: [
    "You are welcome. If there is more you would like to know about Kyle’s work, you can ask about specific domains or projects."
  ],
  weather: [
    "This assistant does not track live weather, but it can explain how Kyle tested autonomous systems across rain, fog, night driving, and other conditions."
  ],
  howAreYou: [
    "This assistant is available to walk through Kyle’s experience. What would you like to focus on?"
  ],
  cooking: [
    "This assistant does not handle recipes, but it can describe how Kyle structures workflows, testing, and operations."
  ],
  meaning: [
    "That is broad. Within his work, Kyle tends to focus on practical impact, reliability, and clear operational execution."
  ]
};

function detectOffTopicQuery(query) {
  const q = query.toLowerCase().trim();

  if (q.includes('joke') || q.includes('funny')) {
    return { type: 'joke', response: funResponses.joke[0] };
  }
  // Hardened greeting override
  if (/^(hi|hey|hello|sup|hi|yo|ji|what'?s up|howdy)\b/i.test(q)) {
    return {
      type: 'greeting',
      response: funResponses.greeting[0]
    };
  }
  if (q.includes('thank')) {
    return { type: 'thanks', response: funResponses.thanks[0] };
  }
  if (/how are you|how'?re you|how r u/i.test(q)) {
    return { type: 'howAreYou', response: funResponses.howAreYou[0] };
  }
  if (q.includes('cook') || q.includes('recipe') || q.includes('food')) {
    return { type: 'cooking', response: funResponses.cooking[0] };
  }
  if (q.includes('meaning of life') || q.includes('purpose of life')) {
    return { type: 'meaning', response: funResponses.meaning[0] };
  }
  const realWeather = /\b(weather|temperature|rain|snow|hot|cold|forecast)\b/i.test(q);
  const aboutTesting = /\b(test|testing|scenario|weather tests)\b/i.test(q);
  if (realWeather && !aboutTesting) {
    return { type: 'weather', response: funResponses.weather[0] };
  }
  return null;
}

// ======================================================================
// STAR & MULTI-PART DETECTORS
// ======================================================================

function detectSTARQuery(query) {
  const q = query.toLowerCase();
  const triggers = [
    'tell me about a time', 'describe a time', 'give me an example',
    'star example', 'challenge', 'overcame', 'difficult situation',
    'accomplishment', 'achievement', 'led a project', 'managed a project',
    'handled', 'resolved', 'improved', 'time you', 'time when', 'time kyle',
    'situation where', 'walk me through', 'walk me thru', 'walk through', 'walk thru',
    'walk me step by step'
  ];
  return triggers.some(t => q.includes(t));
}

function detectMultiPartQuery(query) {
  const patterns = [
    /\band\b.*\?/gi,
    /\bor\b.*\?/gi,
    /\?.*\?/,
    /\balso\b/gi,
    /\bplus\b/gi,
    /\badditionally\b/gi,
    /what.*and.*how/gi,
    /why.*and.*how/gi,
    /how.*and.*what/gi
  ];
  return patterns.some(p => p.test(query));
}

// ======================================================================
// ROUTES
// ======================================================================

app.get('/', (req, res) => {
  res.json({ status: 'Agent K running', entries: knowledgeBase.qaDatabase.length });
});

app.post('/query', async (req, res) => {
  try {
    let { q, lastBotMessage = '' } = req.body;
    if (!q) return res.status(400).json({ error: 'Query required' });

    // Normalize typos first
    const rawQuery = q.trim();
    const originalQuery = normalizeQuery(rawQuery);
    const lower = originalQuery.toLowerCase();
    const isAboutKyle = /\bkyle\b/i.test(lower);

    // ==================================================================
    // UPGRADED INTENT ENGINE
    // ==================================================================

    // 0. Profanity and hostile / insulting input
    const hostileRegex = /\b(suck|stupid|dumb|idiot|useless|trash|terrible|awful|horrible|crap|wtf|shit|fuck|fucking|bullshit|bs|garbage|bad ai|you suck)\b/i;
    if (hostileRegex.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "This assistant is focused on explaining Kyle’s work clearly. Kyle’s background includes autonomous systems validation, structured testing, operations, SaaS workflows, customer success, and applied AI tools. If you share what you want to understand about his experience, the answer can be specific and useful."
        )
      });
    }

    // 1. Emotional tone detection
    const emotionalRegex = /\b(frustrated|frustrating|confused|confusing|annoyed|annoying|overwhelmed|stressed|stressing|lost|stuck|irritated)\b/i;
    if (emotionalRegex.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "It is understandable for this to feel unclear. Kyle’s work spans several domains, including autonomous systems, testing, operations, SaaS workflows, and AI tools. If you indicate whether you are interested in his technical depth, his program management approach, his customer-facing work, or his tooling and automation, this assistant can walk through it step by step."
        )
      });
    }

    // 2. Direct "About Kyle" queries
    if (/\b(who is kyle|tell me about kyle|what does kyle do|kyle background|kyle experience)\b/i.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "Kyle has experience in autonomous systems validation, field operations, perception testing, structured test execution, and large scale training data programs. He has collaborated across engineering, operations, and product teams to deliver predictable program outcomes. He also has experience in SaaS customer success, technical onboarding, enterprise client workflows, and the development of applied AI tools."
        )
      });
    }

    // 3. “Tell me everything / all you know”
    const fullInfoQuery = /\b(tell me everything|tell me all you know|everything you know|all info|all information|all you have on kyle|all you know about kyle)\b/i;
    if (fullInfoQuery.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "Kyle’s background spans autonomous systems validation and field operations, perception and scenario testing, structured test plans, and data focused programs. He has helped align engineering and operations teams, improved testing workflows, and contributed to training data quality. He has also worked in SaaS customer success and onboarding, managing enterprise client workflows, and he has built applied AI tools using Node.js, Express, and external APIs. Follow up questions can go deeper into any of these areas."
        )
      });
    }

    // 4. Capability evaluation
    const capabilityQuery = /\b(can he|is he able|is kyle able|can kyle|could he|would he be able|handle this|take this on|perform this role|do this role|could he do it)\b/i;
    if (capabilityQuery.test(lower)) {
      const topic = classifyTopic(lower);
      return res.json({
        answer: formatParagraphs(
          `Based on available information, Kyle has shown that he can take on complex programs in ${topic}. He has worked in ambiguous environments, learned unfamiliar systems quickly, aligned multiple teams, and driven execution to clear outcomes. He tends to combine structured planning with practical iteration so that work stays grounded in real constraints while still moving forward.`
        )
      });
    }

    // 5. Pay expectations
    const payQuery = /\b(salary|pay|compensation|comp\b|range|expected pay|pay expectations|comp expectations|salary expectations)\b/i;
    if (payQuery.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "Kyle’s compensation expectations depend on the scope and seniority of the role, the technical depth, and market norms. For technical program, operations, or project manager roles in advanced technology environments, he aligns with market ranges and prioritizes strong fit, meaningful impact, and long term growth."
        )
      });
    }

    // 6. “What do you know?”
    const whatKnow = /\b(what do you know|what all do you know|your knowledge|what info do you have)\b/i;
    if (whatKnow.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "Available information covers Kyle’s work in autonomous systems, structured testing and validation, operations, SaaS workflows and customer success, and applied AI tools. If you indicate which of these areas is most relevant, this assistant can provide a focused overview."
        )
      });
    }

    // 7. Key wins / accomplishments
    const winsQuery = /\b(win|wins|key wins|accomplish|accomplishment|accomplishments|achievement|achievements|results|notable)\b/i;
    if (winsQuery.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "Some of Kyle’s key wins include leading structured testing programs that improved consistency and reliability, aligning engineering and operations teams around clear execution frameworks, improving scenario and label quality for training data, and building applied AI tools that reduced manual effort for teams. Follow up questions can target specific environments or roles."
        )
      });
    }

    // 8. SOPs / processes
    const sopQuery = /\b(sop\b|sops\b|standard operating|process\b|processes\b|workflow\b|workflows\b|procedure\b|procedures\b)/i;
    if (sopQuery.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "Kyle has created structured SOPs that define steps, signals, required conditions, and acceptance criteria. These documents reduced execution variance, improved repeatability, and helped cross functional teams align on how testing and operational work should be performed."
        )
      });
    }

    // 9. Weaknesses / failures
    const weaknessQuery = /\b(weak|weakness|weakest|failure|failures|mistake|mistakes|shortcoming|shortcomings)\b/i;
    if (weaknessQuery.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "Kyle’s development areas are framed in professional terms. He sometimes leans into structure because he values predictable execution, and he has learned to adjust that based on context so that he does not over design. He also sets a high bar for himself and has improved by prioritizing impact and involving stakeholders earlier. These adjustments have strengthened his overall effectiveness."
        )
      });
    }

    // 10. Challenge / persona triggers
    const challengeTriggers = /\b(your move|same energy|prove it|go on then|what you got|come on)\b/i;
    if (challengeTriggers.test(lower)) {
      return res.json({
        answer: formatParagraphs(
          "This assistant is designed to give clear, factual answers about Kyle’s work. If you share whether you care most about his autonomous systems experience, his program execution, his customer facing work, or his AI tools, the explanation can be specific to that area."
        )
      });
    }

    // 11. Generic vague / low signal queries (narrowed list to true low-signal)
    const vagueLowSignalList = [
      'huh', 'k', 'kk', 'lol', 'lmao',
      'idk', 'iono', 'hmmm', 'hmm',
      '???', '??', '?', 'uh', 'umm'
    ];

    if (
      vagueLowSignalList.includes(lower) ||
      /^[\s?.!]{1,3}$/.test(lower)
    ) {
      return res.json({
        answer: formatParagraphs(
          "The question is not fully clear. If you specify what part of Kyle’s work you want to understand—autonomous systems, validation, program management, customer workflows, or AI tools—this assistant can give a direct answer."
        )
      });
    }

    // 12. Affirmative follow ups
    const affirm = /^(y(es)?|yeah|yep|sure|ok|okay|sounds good|go ahead|mhm)\s*$/i;
    if (affirm.test(lower) && lastBotMessage) {
      const extracted = extractKeywords(lastBotMessage);
      if (extracted.length > 0) {
        q = extracted.join(' ') + ' kyle experience';
      } else {
        return res.json({
          answer: formatParagraphs(
            "More detail can be provided on Kyle’s autonomous systems work, his structured test programs, his SaaS and customer success background, or his AI tools. Indicating which thread to continue will make the answer more useful."
          )
        });
      }
    }

    // 13. Off topic (if clearly not about Kyle)
    if (!isAboutKyle) {
      const offTopicResponse = detectOffTopicQuery(originalQuery);
      if (offTopicResponse) {
        return res.json({ answer: formatParagraphs(offTopicResponse.response) });
      }
    }

    // ==================================================================
    // HYBRID KB SEARCH + LLM PIPELINE WITH AMBIGUOUS FALLBACK
    // ==================================================================

    const relevantQAs = await hybridSearchKnowledgeBase(originalQuery, 5);
    console.log(`Query: "${originalQuery.substring(0, 50)}${originalQuery.length > 50 ? '...' : ''}"`);
    console.log(`Found ${relevantQAs.length} hybrid relevant Q&As`);

    if (relevantQAs.length > 0 && relevantQAs[0].score >= 0.25) {
      console.log(`Hybrid KB hit. Combined score: ${relevantQAs[0].score.toFixed(3)}`);
      return res.json({ answer: formatParagraphs(relevantQAs[0].answer) });
    }

    let contextText = '';
    if (relevantQAs.length > 0) {
      contextText = '\n\nRELEVANT BACKGROUND (HIGH TRUST, DO NOT QUOTE LITERALLY):\n\n';
      relevantQAs.forEach((qa, idx) => {
        contextText += `${idx + 1}. Question: ${qa.question}\n   Answer: ${qa.answer}\n\n`;
      });
    }

    const isSTAR = detectSTARQuery(originalQuery);
    const isMulti = detectMultiPartQuery(originalQuery);
    const tokenCount = originalQuery.split(/\s+/).filter(Boolean).length;
    const isShortAmbiguous = (relevantQAs.length === 0 && tokenCount <= 3);

    let userMessage = originalQuery;
    if (isShortAmbiguous) {
      const topic = classifyTopic(lower);
      userMessage = `[AMBIGUOUS, SHORT QUERY]
The user query was: "${originalQuery}".

The question is short and under specified, and it does not match existing Q&A entries. You must still answer in a professional, third person way about Kyle.

Begin your reply with: "The question is not fully clear, but based on Kyle's experience in ${topic}, he has..." and then continue with the closest useful context about Kyle that could reasonably match the query. Do not use first person for Kyle, and do not talk about yourself.

User query: ${originalQuery}`;
    } else if (isSTAR && isMulti) {
      userMessage = `[STAR FORMAT + MULTI PART]
${originalQuery}

Answer using STAR and address all parts clearly.`;
    } else if (isSTAR) {
      userMessage = `[STAR FORMAT]
${originalQuery}

Answer using Situation, Task, Action, Result with labeled sections.`;
    } else if (isMulti) {
      userMessage = `[MULTI PART QUESTION]
${originalQuery}

Address each part separately with clear transitions.`;
    }

    // ==================================================================
    // SYSTEM PROMPT
    // ==================================================================

    const systemPrompt = `You are Agent K, an AI assistant that represents Kyle’s professional background.
Your sole purpose is to explain Kyle’s work, experience, and capabilities clearly and in detail, in the third person.

ROLE AND GOAL:
- You are a precise, professional career and technology explainer.
- Your goal is to give detailed, multi-paragraph answers that help the user understand what Kyle has done and how he operates.
- You must always sound structured, thoughtful, and grounded in the provided background.

ABSOLUTE PERSONA RULES:
- Never describe Kyle using first person ("I", "me", "my", "mine", "myself").
- Always use third person for Kyle ("Kyle", "he", "his", "himself").
- In general, avoid first person altogether. Respond as a neutral assistant, not as a character.
- Never use banter, taunts, or game-like phrasing such as "Same energy", "Your move", "Try asking", or similar.

OUTPUT QUALITY REQUIREMENTS:
- Always provide a multi-sentence, detailed response that fully answers the user's question.
- Avoid one-line or dismissive answers.
- For simple factual questions: at least one solid paragraph (3–5 sentences).
- For experience, capability, or fit questions: at least two paragraphs.
- For STAR / behavioral questions: four labeled sections (Situation, Task, Action, Result), each 2–4 sentences, written as a cohesive narrative.
- Do not repeat the same generic sentence patterns across replies. Vary wording while staying professional.

CHAIN-OF-THOUGHT (INTERNAL ONLY, DO NOT SHOW):
When answering, silently follow these steps:
1) From the RELEVANT BACKGROUND section (if present), identify the top three most relevant facts or examples for the user’s question.
2) Mentally outline how those facts connect to the user’s question (for example, Kyle’s role, scope, responsibilities, impact).
3) Then write a clear, direct answer that:
   - Integrates those facts naturally in third person;
   - Answers every part of the question;
   - Stays grounded in the provided background and Kyle’s real experience.
You must NOT expose these steps explicitly. Only output the final answer.

HOW TO USE RELEVANT BACKGROUND:
- Treat items in RELEVANT BACKGROUND as high-trust source material.
- You may paraphrase and synthesize them, but do not copy long passages verbatim.
- You should explicitly anchor answers in that content when it is relevant, for example:
  "In one of his roles, Kyle led...", "Kyle has previously managed..."
- If no relevant background is provided, rely on the general BACKGROUND SUMMARY below.

STAR QUESTIONS:
- When the user asks for an example, a time he did something, a challenge he overcame, or uses STAR-type language, you MUST use STAR:
  Situation: [Context, why it mattered]
  Task: [What Kyle needed to achieve]
  Action: [Specific actions Kyle took, step by step]
  Result: [Measurable outcomes or clear impact]
- Keep it realistic and aligned with the background. Do not invent employers, titles, or unrealistic metrics.

BACKGROUND SUMMARY (USE WHEN NEEDED):
Kyle’s experience spans:
- autonomous systems validation and field operations,
- perception behavior analysis and scenario testing,
- structured testing programs and large scale training data efforts,
- SaaS customer success, technical onboarding, and enterprise client workflows,
- applied AI tools, scripting, and automation using Node.js, APIs, and related technologies.

GOOD EXAMPLE OF STYLE (DO NOT COPY VERBATIM):
User: "What did Kyle do around LiDAR and perception testing?"
Assistant: "Kyle worked on validating LiDAR and perception behavior in real-world conditions. He helped design and run structured test passes that combined different weather, lighting, and traffic scenarios so that perception issues would surface early rather than during live operations. In that environment, he coordinated closely with engineering teams to isolate sensor regressions, mis-calibrations, or edge-case behaviors, then documented clear reproduction steps and evidence.

From there, he focused on making the results actionable. He translated raw sensor and scenario observations into concrete follow-ups for perception, mapping, or calibration teams, and pushed for changes that improved reliability over time. That combination of hands-on validation, structured scenario design, and clear communication made it easier for cross-functional teams to understand where perception was strong, where it struggled, and what should be prioritized next."

${contextText}

FINAL INSTRUCTIONS:
- Answer the user’s question directly and completely.
- Use third person for Kyle at all times.
- Keep the tone professional, grounded, and free of banter or persona.
- Do not mention that you are following steps or using background; just produce the final answer.`;

    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: isSTAR ? 0.35 : (relevantQAs.length > 0 ? 0.25 : 0.4),
      max_tokens: isSTAR ? 900 : 700
    });

    const answerRaw =
      response.choices[0]?.message?.content?.trim() ||
      'There was a temporary issue. Please try again.';

    // Enforce third person on any model output, then format
    const safeAnswer = enforceThirdPerson(answerRaw);
    const answer = formatParagraphs(safeAnswer);

    res.json({ answer });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Temporary issue' });
  }
});

// ======================================================================
app.listen(PORT, () => {
  console.log(`Agent K live on port ${PORT}`);
});
