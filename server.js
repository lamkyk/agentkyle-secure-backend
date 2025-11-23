import express from "express";
import cors from "cors";
import Groq from "groq-sdk";

const app = express();
app.use(cors());
app.use(express.json());

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

app.post("/query", async (req, res) => {
  try {
    const userMessage = req.body.q;

    const completion = await client.chat.completions.create({
      model: "model="llama-3.3-70b-versatile"",
      messages: [
        {
          role: "system",
          content:
            "You are Agent Kyle, a natural conversational assistant who answers only based on Kyle's resume and provided facts. Respond in a natural tone. Avoid corporate tone. If unsure, say 'I’m not totally sure.'"
        },
        {
          role: "user",
          content: userMessage
        }
      ]
    });

    res.json({ answer: completion.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Backend error", detail: err.message });
  }
});

app.get("/", (_, res) => {
  res.send("Agent Kyle backend is running.");
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Backend running on port", port));
