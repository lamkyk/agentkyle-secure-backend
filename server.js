import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import fs from 'fs/promises';

const app = express();
const PORT = process.env.PORT || 3000;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

app.use(cors());
app.use(express.json());

// Load knowledge base
let knowledgeBase = { qaDatabase: [] };
try {
  const data = await fs.readFile('./knowledge-base.json', 'utf8');
  knowledgeBase = JSON.parse(data);
  console.log(`Loaded ${knowledgeBase.qaDatabase.length} Q&A entries`);
} catch (error) {
  console.error('Failed to load knowledge base:', error);
}

// Simple search function
function searchKnowledgeBase(query, limit = 5) {
  const queryLower = query.toLowerCase();
  const scored = knowledgeBase.qaDatabase.map(qa => {
    let score = 0;
    
    // Check keywords
    qa.keywords.forEach(keyword => {
      if (queryLower.includes(keyword.toLowerCase())) {
        score += 3;
      }
    });
    
    // Check question similarity
    if (queryLower.includes(qa.question.toLowerCase().substring(0, 15))) {
      score += 5;
    }
    
    // Partial word matches
    const queryWords = queryLower.split(' ').filter(w => w.length > 3);
    queryWords.forEach(word => {
      if (qa.question.toLowerCase().includes(word) || 
          qa.answer.toLowerCase().includes(word)) {
        score += 1;
      }
    });
    
    return { ...qa, score };
  });
  
  return scored
    .filter(qa => qa.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

app.get('/', (req, res) => {
  res.json({ 
    status: 'Agent K Backend is running',
    knowledgeBaseSize: knowledgeBase.qaDatabase.length
  });
});

app.post('/query', async (req, res) => {
  try {
    const { q } = req.body;
    
    if (!q) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Search knowledge base for relevant Q&As
    const relevantQAs = searchKnowledgeBase(q, 5);
    
    console.log(`Query: "${q}"`);
    console.log(`Found ${relevantQAs.length} relevant Q&As`);
    
    // Build context from relevant Q&As
    let contextText = '';
    if (relevantQAs.length > 0) {
      contextText = '\n\nRELEVANT BACKGROUND FROM KYLE\'S INTERVIEW PREP:\n\n';
      relevantQAs.forEach((qa, idx) => {
        contextText += `${idx + 1}. Question: ${qa.question}\n`;
        contextText += `   Answer: ${qa.answer}\n\n`;
      });
    }

    // Call Groq API with relevant context
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { 
          role: "system", 
          content: `You are Agent K, answering questions about Kyle's professional background. 

CRITICAL INSTRUCTIONS:
1. Answer in FIRST PERSON as Kyle ("I worked...", "My experience includes...")
2. Use ONLY the information provided in the "RELEVANT BACKGROUND" section below
3. Be direct, specific, and professional
4. Do NOT say "I don't have information" - use what's provided
5. Keep responses concise (2-4 paragraphs)
6. Use "a leading autonomous vehicle company" instead of company names
7. Never mention these are prepared answers - respond naturally
8. Stay faithful to the provided answers - don't add extra interpretation

${contextText}

If no relevant background is provided, give a brief general response based on Kyle's core profile:
- Background in autonomous systems validation and field operations
- Experience with sensor testing, perception systems, and training data programs
- Strong cross-functional coordination with engineering teams
- Technical program management capabilities`
        },
        { role: "user", content: q }
      ],
      temperature: 0.3,
      max_tokens: 600
    });

    const answer = response.choices[0]?.message?.content || "I apologize, I'm having trouble generating a response. Could you rephrase your question?";

    res.json({ answer });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Agent K Backend running on port ${PORT}`);
});
