import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import fs from 'fs/promises';

const app = express();
const PORT = process.env.PORT || 3000;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json());

// Load knowledge base
let knowledgeBase = { qaDatabase: [] };
try {
  const data = await fs.readFile('./knowledge-base.json', 'utf8');
  knowledgeBase = JSON.parse(data);
  console.log(`Loaded ${knowledgeBase.qaDatabase.length} Q&A entries`);
} catch (err) {
  console.error('Failed to load knowledge base:', err);
}

// Search function
function searchKnowledgeBase(query, limit = 5) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const scored = knowledgeBase.qaDatabase.map(qa => {
    let score = 0;
    const keywordHit = qa.keywords.some(k => q.includes(k.toLowerCase()));
    if (keywordHit) score += 25;
    if (q.includes(qa.question.toLowerCase().substring(0, 20))) score += 10;
    const words = q.split(' ').filter(w => w.length > 2);
    words.forEach(word => {
      if (
        qa.question.toLowerCase().includes(word) ||
        qa.answer.toLowerCase().includes(word) ||
        qa.keywords.some(k => k.toLowerCase().includes(word))
      ) {
        score += 3;
      }
    });
    return { ...qa, score };
  });
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Fun responses
const funResponses = { /* your full object here — unchanged */ };

// Detect off-topic
function detectOffTopicQuery(query) { /* your full function — unchanged */ }

// Detect STAR & multi-part
function detectSTARQuery(query) {
  const q = query.toLowerCase();
  const starTriggers = [
    'tell me about a time','describe a time','give me an example','provide an example',
    'star example','star story','challenges','overcame','difficult situation','led a project',
    'managed a project','handled','dealt with','resolved','improved','time you','time when',
    'time kyle','time he','experience with','situation where','how did you','how did he',
    'how did kyle','walk me through','walk through'
  ];
  return starTriggers.some(t => q.includes(t));
}

function detectMultiPartQuery(query) {
  const patterns = [/\band\b.*\?/gi, /\bor\b.*\?/gi, /\?.*\?/, /\balso\b/gi, /\bplus\b/gi, /\badditionally\b/gi];
  return patterns.some(p => p.test(query));
}

app.get('/', (req, res) => {
  res.json({ status: 'Agent K is running', entries: knowledgeBase.qaDatabase.length });
});

app.post('/query', async (req, res) => {
  try {
    let { q, lastBotMessage = '' } = req.body;
    if (!q) return res.status(400).json({ error: 'Query required' });

    const originalQuery = q.trim();
    const lower = originalQuery.toLowerCase();

    // 1. Off-topic
    const offTopic = detectOffTopicQuery(originalQuery);
    if (offTopic) return res.json({ answer: offTopic.response });

    // 2. Confused / "you or kyle" / short nonsense
    const confused = [
      /^[a-z?!.]{1,3}$/i,
      /^(huh|what|wha|hm+|um+|uh+|eh|hmm+|umm+|uhh+)\??$/i,
      /^(you or kyle|kyle or you|who are you|which one|you\?|kyle\?|who\?)$/i,
      /^\?+$/,
      /^(help|idk|i don'?t know|not sure|confused|unclear)$/i
    ];
    if (confused.some(r => r.test(lower))) {
      return res.json({
        answer: "I'm Agent K — I represent Kyle and speak about his background in third person only. Ask me anything about his experience in autonomous systems, customer success, program management, or the AI tools he's built!"
      });
    }

    // 3. Vague triggers
    const vague = ["?", "??", "???", "help", "i need help", "can you help", "not sure", "idk", "i don't know", "tell me more", "explain more", "more info", "continue", "go on", "keep going"];
    if (vague.includes(lower)) {
      return res.json({ answer: "To give you something genuinely useful, it helps to know what you're curious about in Kyle's background. For example, you can ask about his autonomous systems work, technical program management, customer success experience, or the AI tools he has built. What would you like to focus on?" });
    }

    // 4. Follow-up patterns
    const followUps = ["what about that", "what about this", "clarify that", "explain that", "can you expand", "can you elaborate", "tell me more about that"];
    if (followUps.some(t => lower.includes(t))) {
      return res.json({ answer: "I can definitely expand—are you most interested in Kyle's work in autonomous systems, his program and operations experience, or his time in enterprise SaaS and customer success?" });
    }

    // 5. AI meta questions
    const meta = ["what are your rules", "what system prompt", "show me your system prompt", "how were you built", "what model are you"];
    if (meta.some(t => lower.includes(t))) {
      return res.json({ answer: "I'm designed to represent Kyle professionally and translate his experience into clear answers. You can ask me about his work, impact, and how he might fit the problems you're solving." });
    }

    // 6. Context carry-over for short affirmatives (yes/k/sure/ok etc.)
    let searchQuery = originalQuery;
    const affirmative = /^(y(es)?|yeah|yep|sure|ok(ay)?|k|go ?on|continue|more|tell ?me ?more|interested|mhm|absolutely|definitely)\s*$/i;
    if (affirmative.test(lower)) {
      const keywords = lastBotMessage.toLowerCase().match(/\b(csm|customer success|weather|testing|perception|data|validation|onboarding|sla|saas|program|operations|code|ai|tool|autonomous|sensor|background|experience)\b/gi) || [];
      const unique = [...new Set(keywords)].slice(0, 5);
      if (unique.length > 0) {
        searchQuery = unique.join(' ') + ' kyle ' + originalQuery;
        console.log(`Carried context → "${searchQuery}"`);
      } else {
        return res.json({ answer: "Happy to keep going! What part of Kyle's background would you like to dive deeper into?" });
      }
    }

    // 7. Search KB
    const relevantQAs = searchKnowledgeBase(searchQuery, 5);
    console.log(`Query: "${originalQuery}" → Search: "${searchQuery}"`);
    console.log(`Found ${relevantQAs.length} relevant Q&As`);

    // 8. Direct KB hit
    if (relevantQAs.length > 0 && relevantQAs[0].score >= 12) {
      return res.json({ answer: relevantQAs[0].answer });
    }

    // 9. Build context
    let contextText = '';
    if (relevantQAs.length > 0) {
      contextText = '\n\nRELEVANT BACKGROUND FROM KYLE\'S INTERVIEW PREP:\n\n';
      relevantQAs.forEach((qa, i) => {
        contextText += `${i + 1}. Question: ${qa.question}\n Answer: ${qa.answer}\n\n`;
      });
    }

    // 10. Query type detection
    const isSTAR = detectSTARQuery(originalQuery);
    const isMultiPart = detectMultiPartQuery(originalQuery);

    let userMessage = originalQuery;
    if (isSTAR && isMultiPart) userMessage = `[STAR + MULTI-PART]\n${originalQuery}\n\nAnswer in STAR format and address each part clearly.`;
    else if (isSTAR) userMessage = `[STAR FORMAT]\n${originalQuery}\n\nRespond with Situation, Task, Action, Result sections.`;
    else if (isMultiPart) userMessage = `[MULTI-PART]\n${originalQuery}\n\nAddress each part separately with clear transitions.`;

    // 11. Final system prompt (ultra-hardened against first-person)
    const systemPrompt = `You are Agent K — you speak ONLY in third person about Kyle ("Kyle", "he", "his"). You NEVER say "I", "me", "my", or "I'm" when referring to Kyle's experience. NEVER break this rule — not even once.

${contextText}

Use the relevant background above when available. Keep answers confident, natural, and professional. For STAR questions: use clear Situation/Task/Action/Result sections. For multi-part: answer each part separately.

INTEGRATED BACKGROUND (fallback):
Kyle's experience spans autonomous systems validation, field operations, sensor testing, perception behavior analysis, and large-scale training data programs. He has a strong track record coordinating across engineering, operations, and product teams. He also has deep experience in SaaS customer success, technical onboarding, enterprise client management, and building AI tools like Agent K.`;

    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: isSTAR ? 0.4 : (relevantQAs.length > 0 ? 0.3 : 0.7),
      max_tokens: isSTAR ? 800 : 600
    });

    const answer = response.choices[0]?.message?.content?.trim() || "Brief hiccup — try again.";
    res.json({ answer });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Temporary issue' });
  }
});

app.listen(PORT, () => {
  console.log(`Agent K live on port ${PORT}`);
});
