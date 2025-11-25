<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Agent K Chat</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; font-family: "Lato", sans-serif !important; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
.wrapper { width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.header { padding: 16px 20px; background: white; border-bottom: 1px solid #eee; font-size: 20px; font-weight: 600; flex-shrink: 0; }
@media (min-width: 768px) { .header { font-size: 24px; } }
.chat-inner { width: 100%; max-width: 650px; margin: 0 auto; display: flex; flex-direction: column; flex: 1; }
@media (min-width: 768px) { .chat-inner { max-width: 880px; } }
#chatBody { overflow-y: auto; padding: 16px 20px; padding-bottom: 100px; display: flex; flex-direction: column; gap: 14px; -webkit-overflow-scrolling: touch; }
#chatBody::after { content: ""; height: 1px; display: block; }
#chatBody::-webkit-scrollbar { width: 8px; }
#chatBody::-webkit-scrollbar-track { background: white; }
#chatBody::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }
#chatBody { scrollbar-color: #ccc white; }
#inputBar { padding: 14px 20px; background: #fff; border-top: 1px solid #ddd; display: flex; gap: 10px; align-items: flex-end; padding-bottom: calc(18px + env(safe-area-inset-bottom)); margin-bottom: env(safe-area-inset-bottom); flex-shrink: 0; z-index: 20; }
#input { flex: 1; min-height: 48px; max-height: 140px; padding: 12px; border-radius: 12px; border: 1px solid #ddd; resize: none; outline: none; font-size: 16px; }
#sendBtn { padding: 12px 20px; height: 48px; border-radius: 12px; border: none; background: #1f2937; color: white; font-size: 15px; font-weight: 600; cursor: pointer; flex-shrink: 0; }
.msg-row { display: flex; }
.msg-user { justify-content: flex-end; }
.msg-bot { justify-content: flex-start; }
.bubble { max-width: 85%; padding: 12px 16px; border-radius: 14px; font-size: 16px; line-height: 1.5; }
.bubble-user { background: #1f2937; color: white; border-bottom-right-radius: 4px; }
.bubble-bot { background: #f5f5f5; color: #111; border-bottom-left-radius: 4px; }
.footer-note { text-align: center; font-size: 9px; color: #555; opacity: 0.85; padding: 6px 0; margin-top: 4px; margin-bottom: calc(6px + env(safe-area-inset-bottom)); line-height: 1.3; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="chat-inner">
    <div class="header">You are chatting with Agent K</div>
    <div id="chatBody"></div>
    <div id="inputBar">
      <textarea id="input" placeholder="Ask about Kyle's experience..." autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false"></textarea>
      <button id="sendBtn">Send</button>
    </div>
    <div class="footer-note">
      Agent K can make mistakes. Feel free to reach out directly.<br>
      2025-2026
    </div>
  </div>
</div>

<!-- ONLY ADDED: hidden field + tiny script -->
<input type="hidden" id="lastBotMessage" value="">

<script>
/* MEGA FIX: stable height using visual viewport */
function adjustHeights() {
  const vv = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const headerH = document.querySelector('.header').offsetHeight;
  const inputH = document.querySelector('#inputBar').offsetHeight;
  const chatBody = document.querySelector('#chatBody');
  chatBody.style.height = (vv - headerH - inputH) + "px";
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', adjustHeights);
  window.visualViewport.addEventListener('scroll', adjustHeights);
}
window.addEventListener('orientationchange', adjustHeights);
window.addEventListener('load', adjustHeights);
adjustHeights();

/* chat logic */
const chatBody = document.getElementById("chatBody");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const lastBotMessageHidden = document.getElementById("lastBotMessage");
let lastBotText = "";

/* Tiny helper: keep last bot message in hidden field */
function updateLastBotMessage() {
  const lastBubble = chatBody.querySelector(".msg-bot:last-child .bubble");
  if (lastBubble) {
    lastBotText = lastBubble.textContent.trim();
    lastBotMessageHidden.value = lastBotText;
  }
}

function addMsg(type, text) {
  const row = document.createElement("div");
  row.className = "msg-row " + (type === "user" ? "msg-user" : "msg-bot");
  const bubble = document.createElement("div");
  bubble.className = "bubble " + (type === "user" ? "bubble-user" : "bubble-bot");
  bubble.textContent = text;
  row.appendChild(bubble);
  chatBody.appendChild(row);
  requestAnimationFrame(() => {
    chatBody.scrollTop = chatBody.scrollHeight;
    adjustHeights();
    if (type === "bot") updateLastBotMessage();
  });
}

async function send() {
  const q = input.value.trim();
  if (!q) return;
  addMsg("user", q);
  input.value = "";
  input.style.height = "48px";
  sendBtn.disabled = true;
  try {
    const res = await fetch("https://agentkyle-secure-backend.onrender.com/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: q,
        lastBotMessage: lastBotText               // ← THIS IS THE ONLY NEW LINE
      })
    });
    if (!res.ok) {
      addMsg("bot", "The server is waking up. Please try again in a moment.");
      sendBtn.disabled = false;
      return;
    }
    const data = await res.json();
    addMsg("bot", data.answer || "I didn’t get a usable reply. Try again.");
  } catch (e) {
    addMsg("bot", "There was a network issue. Please try again.");
  }
  sendBtn.disabled = false;
  input.focus();
}

sendBtn.addEventListener("click", send);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
input.addEventListener("input", () => {
  input.style.height = "48px";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
  chatBody.scrollTop = chatBody.scrollHeight;
  adjustHeights();
});

/* prevent accidental zoom */
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
}, false);

/* initial greeting */
addMsg("bot", "Hi, I am Agent K. I can answer questions about Kyle's professional experience, skills, and background. What would you like to know?");
</script>
</body>
</html>
