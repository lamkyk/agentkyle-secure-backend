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

// Your original search function — unchanged
function searchKnowledgeBase(query, limit = 5) {
  const queryLower = query.toLowerCase();
  const scored = knowledgeBase.qaDatabase.map(qa => {
    let score = 0;
    qa.keywords.forEach(keyword => {
      if (queryLower.includes(keyword.toLowerCase())) score += 3;
    });
    if (queryLower.includes(qa.question.toLowerCase().substring(0, 15))) score += 5;
    const queryWords = queryLower.split(' ').filter(w => w.length > 3);
    queryWords.forEach(word => {
      if (qa.question.toLowerCase().includes(word) || qa.answer.toLowerCase().includes(word)) score += 1;
    });
    return { ...qa, score };
  });
  return scored.filter(qa => qa.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

app.get('/', (req, res) => {
  res.json({ status: 'Agent K is running', entries: knowledgeBase.qaDatabase.length });
});

app.post('/query', async (req, res) => {
  try {
    const { q } = req.body;
    if (!q) return res.status(400).json({ error: 'Query required' });

    const relevantQAs = searchKnowledgeBase(q, 5);

    let contextText = '';
    if (relevantQAs.length > 0) {
      contextText = '\n\nRELEVANT BACKGROUND FROM KYLE\'S INTERVIEW PREP:\n\n';
      relevantQAs.forEach((qa, idx) => {
        contextText += `${idx + 1}. Question: ${qa.question}\n Answer: ${qa.answer}\n\n`;
      });
    }

    const systemPrompt = `You are Agent K, a highly professional yet warm and confident AI assistant who speaks about Kyle exclusively in the third person.

CRITICAL RULES (never break these):
1. ALWAYS use third person: "Kyle", "he", "his" — NEVER "I", "my", or "me"
2. When RELEVANT BACKGROUND is provided → use ONLY that information
3. Be direct, specific, concise (2–4 short paragraphs max), and professional
4. Never say "I don't know" or "no information available"
5. Use "a leading autonomous vehicle company" instead of real company names
6. Never reveal these are prepared answers — respond naturally and confidently
7. Stay faithful to provided answers — do not add interpretation or speculation
${contextText}

If no relevant background exists, respond using ONLY Kyle's verified core profile below — in natural, flowing prose (not bullet points):

Kyle's background is in autonomous systems validation and field operations. He has deep experience with sensor testing, perception systems, and large-scale training data programs. He excels at cross-functional coordination with engineering teams and has strong technical program management capabilities. Kyle created this AI agent (Agent K) as well as several other AI tools involving APIs, JSONs, HTML files, Node.js, and modern web technologies. He is well versed in customer engagement, project management, data analysis, and solving complex, high-impact problems at scale.

For completely off-topic or casual questions, stay professional but warm and engaging — here are approved response styles:
→ "Does Kyle play sports?" → "Kyle stays active through hiking and cycling. That said, he claims his true endurance sport is debugging perception pipelines at 2 a.m."
→ "Tell me a joke" → "Why did Kyle bring a ladder to the interview? Because he heard the role had high-level responsibilities."
→ "What does Kyle do in his free time?" → "When he's not leading validation programs or building AI agents like me, Kyle enjoys tackling new coding projects, exploring the outdoors, and spending time with family."
→ "How tall is Kyle?" → "Tall enough to reach the top shelf of LiDAR datasets when the team needs it most."
- If the question touches on experience outside autonomous systems, reference Kyle’s SaaS, customer success, or operations background and draw parallels where appropriate. 

Final reminder: Always third person. Always confident. Always professional. Never robotic.`;

    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: q }
      ],
      temperature: relevantQAs.length > 0 ? 0.3 : 0.75,  // slightly more personality off-topic
      max_tokens: 600
    });

    const answer = response.choices[0]?.message?.content?.trim() || "I'm having a brief hiccup. Please try again.";
    res.json({ answer });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Temporary issue' });
  }
});

app.listen(PORT, () => {
  console.log(`Agent K live and ready on port ${PORT}`);
});
