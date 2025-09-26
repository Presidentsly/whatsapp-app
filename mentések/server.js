const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' }); // path javítva

const messages = [];

// LocalAuth session mappa (Windows zárolás elkerülésére új mappa)
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'default',
        dataPath: './wwebjs_auth_safe' // új mappa
    })
});

client.on('qr', qr => {
    console.log('QR kód beolvasáshoz:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', session => {
    console.log('WhatsApp session mentve!');
});

client.on('ready', () => {
    console.log('WhatsApp kliens csatlakozott!');

    // WebSocket kapcsolat és üzenetek csak itt
    wss.on('connection', socket => {
        // Előzmények elküldése
        socket.send(JSON.stringify({ type:'history', payload: messages }));

        // Front-endről érkező üzenetek
        socket.on('message', async data => {
            try {
                const { type, payload } = JSON.parse(data);
                if(type === 'send') {
                    const { to, text } = payload;
                    if(to && text) {
                        await client.sendMessage(to, text);
                        console.log('Elküldve:', text, '->', to);
                    }
                }
            } catch(err) { console.error(err); }
        });
    });

    // Bejövő üzenetek kezelése
    client.on('message', async msg => {
        try {
            const contact = await msg.getContact();
            const item = {
                from: msg.from,
                name: contact.pushname || contact.number,
                text: msg.body,
                t: Date.now()
            };
            messages.push(item);
            if(messages.length > 200) messages.shift();

            const data = JSON.stringify({ type:'message', payload: item });
            wss.clients.forEach(socket => {
                if(socket.readyState === WebSocket.OPEN) socket.send(data);
            });
        } catch(err) { console.error(err); }
    });
});

// Front-end HTML
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>WhatsApp Közös Nézet + Válasz</title>
<style>
body { font-family: sans-serif; background:#f4f4f4; }
.messages { max-width:800px; margin:20px auto; padding:10px; background:#fff; border-radius:8px; height:60vh; overflow:auto; }
.msg { margin:10px 0; padding:8px 12px; background:#eef; border-radius:6px; }
.meta { font-size:12px; color:#666; margin-bottom:4px; }
.reply-btn { margin-left:10px; font-size:11px; padding:2px 6px; cursor:pointer; }
form { max-width:800px; margin:10px auto; display:flex; gap:10px; }
input[type=text] { flex:1; padding:8px; border-radius:6px; border:1px solid #ccc; }
button { padding:8px 14px; border:none; border-radius:6px; background:#4caf50; color:#fff; font-weight:bold; cursor:pointer; }
</style>
</head>
<body>
<h2 style="text-align:center">WhatsApp – Közös nézet és válasz</h2>
<div class="messages" id="messages"></div>
<form id="chatForm">
<input type="hidden" id="target" value="">
<input type="text" id="reply" placeholder="Írd ide az üzenetet..." required />
<button type="submit">Küldés</button>
</form>
<script>
const messagesEl = document.getElementById('messages');
const targetInput = document.getElementById('target');
const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');

ws.onopen = () => console.log('WebSocket csatlakozott!');
ws.onerror = err => console.error('WebSocket hiba:', err);

function addMessage(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'msg';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (msg.name || msg.from) + ' @ ' + new Date(msg.t).toLocaleString();
    const replyBtn = document.createElement('button');
    replyBtn.textContent = 'Válasz';
    replyBtn.className = 'reply-btn';
    replyBtn.onclick = () => targetInput.value = msg.from;
    meta.appendChild(replyBtn);
    wrap.appendChild(meta);
    wrap.appendChild(document.createTextNode(msg.text));
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

ws.onmessage = ev => {
    const { type, payload } = JSON.parse(ev.data);
    if(type === 'history') payload.forEach(addMessage);
    if(type === 'message') addMessage(payload);
};

document.getElementById('chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const text = document.getElementById('reply').value.trim();
    const to = targetInput.value;
    if(!text || !to) { alert('Válaszd ki, kinek küldöd!'); return; }
    ws.send(JSON.stringify({ type:'send', payload: { to, text } }));
    document.getElementById('reply').value = '';
});
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Szerver fut: http://localhost:' + PORT));

client.initialize();
