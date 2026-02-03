const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const messages = []; // Csak szöveges üzenetek, max 100
const authPath = path.join('/tmp', 'wwebjs_auth_safe');

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'default', dataPath: authPath }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ]
    }
});

// QR kód a konzolra
client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('authenticated', () => console.log('WhatsApp session mentve!'));
client.on('ready', () => console.log('WhatsApp kliens csatlakozott!'));

// WebSocket + chat kezelés
wss.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'history', payload: messages }));

    socket.on('message', async data => {
        try {
            const { type, payload } = JSON.parse(data);
            if (type === 'send') {
                const { to, text } = payload;
                if (to && text) {
                    await client.sendMessage(to, text);
                    const item = { from: 'Me', name: 'Te', text, t: Date.now() };
                    messages.push(item);
                    if (messages.length > 100) messages.shift();

                    const dataToSend = JSON.stringify({ type: 'message', payload: item });
                    wss.clients.forEach(s => s.readyState === WebSocket.OPEN && s.send(dataToSend));
                }
            }
        } catch (err) { console.error('WS send error:', err); }
    });
});

// Csak szöveges üzenetek, média NEM
client.on('message', msg => {
    try {
        const item = { from: msg.from, name: msg._data?.notifyName || msg.from, text: msg.body, t: Date.now() };
        messages.push(item);
        if (messages.length > 100) messages.shift();

        const dataToSend = JSON.stringify({ type: 'message', payload: item });
        wss.clients.forEach(s => s.readyState === WebSocket.OPEN && s.send(dataToSend));
    } catch (err) { console.error('Message error:', err); }
});

// Frontend HTML (egyszerűsített)
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>WhatsApp Közös Nézet</title>
<style>
body { font-family:sans-serif; background:#f4f4f4; }
.header { text-align:center; margin:10px auto; font-size:18px; color:#000; }
.messages { max-width:800px; margin:0 auto; padding:10px; background:#fff; border-radius:8px; height:60vh; overflow:auto; }
.msg { margin:10px 0; padding:8px 12px; background:#eef; border-radius:6px; }
form { max-width:800px; margin:10px auto; display:flex; gap:10px; }
input { flex:1; padding:8px; border-radius:6px; border:1px solid #ccc; }
button { padding:8px 14px; border:none; border-radius:6px; background:#4caf50; color:#fff; cursor:pointer; }
</style>
</head>
<body>
<div class="header">WhatsApp – Közös nézet</div>
<div class="messages" id="messages"></div>
<form id="chatForm">
<input type="hidden" id="target" value="">
<input type="text" id="reply" placeholder="Írd ide az üzenetet..." required />
<button type="submit">Küldés</button>
</form>
<script>
const messagesEl = document.getElementById('messages');
const targetInput = document.getElementById('target');
const replyInput = document.getElementById('reply');
const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');

function addMessage(msg){
    const div=document.createElement('div'); div.className='msg';
    div.textContent=(msg.name||msg.from)+': '+msg.text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop=messagesEl.scrollHeight;
}

ws.onmessage = ev => {
    const { type, payload } = JSON.parse(ev.data);
    if(type==='history') payload.forEach(addMessage);
    if(type==='message') addMessage(payload);
};

document.getElementById('chatForm').addEventListener('submit', e=>{
    e.preventDefault();
    const text=replyInput.value.trim();
    const to=targetInput.value||'status'; // alapértelmezett
    if(!text) return;
    ws.send(JSON.stringify({ type:'send', payload:{to,text} }));
    replyInput.value='';
});
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Szerver fut: http://localhost:' + PORT));

client.initialize();
