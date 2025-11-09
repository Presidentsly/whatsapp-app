const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const messages = [];

// LocalAuth session mappa
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'default',
        dataPath: './wwebjs_auth_safe'
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

    // WebSocket kapcsolat
    wss.on('connection', socket => {
        socket.send(JSON.stringify({ type:'history', payload: messages }));

        socket.on('message', async data => {
            try {
                const { type, payload } = JSON.parse(data);
                if(type === 'send') {
                    const { to, text } = payload;
                    if(to && text) {
                        await client.sendMessage(to, text);
                        const item = {
                            from: 'Me',
                            name: 'Te',
                            text,
                            t: Date.now()
                        };
                        messages.push(item);
                        if(messages.length > 200) messages.shift();
                        const dataToSend = JSON.stringify({ type:'message', payload: item });
                        wss.clients.forEach(s => {
                            if(s.readyState === WebSocket.OPEN) s.send(dataToSend);
                        });
                    }
                }
            } catch(err) { console.error(err); }
        });
    });

    client.on('message', async msg => {
        try {
            const contact = await msg.getContact();
            const item = {
                from: msg.from,
                name: contact.pushname || contact.number,
                text: msg.body,
                t: Date.now()
            };

            if (msg.hasMedia) {
                const media = await msg.downloadMedia();
                if (media && media.data) {
                    item.media = {
                        mimetype: media.mimetype,
                        data: media.data
                    };
                }
            }

            messages.push(item);
            if(messages.length > 200) messages.shift();

            const dataToSend = JSON.stringify({ type:'message', payload: item });
            wss.clients.forEach(socket => {
                if(socket.readyState === WebSocket.OPEN) socket.send(dataToSend);
            });
        } catch(err) { console.error(err); }
    });
});

// Frontend
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>WhatsApp Közös Nézet + Válasz</title>
<style>
body { font-family: sans-serif; background:#f4f4f4; }
.header { text-align:center; margin:10px auto; font-size:18px; color:#000; display:flex; justify-content:space-between; align-items:center; max-width:800px; }
.clock { color:#ffd106; font-weight:bold; }
.messages { max-width:800px; margin:0 auto 20px; padding:10px; background:#fff; border-radius:8px; height:60vh; overflow:auto; }
.msg { margin:10px 0; padding:8px 12px; background:#eef; border-radius:6px; position:relative; }
.meta { font-size:12px; color:#666; margin-bottom:4px; }
.reply-btn, .del-btn { margin-left:5px; font-size:11px; padding:2px 6px; cursor:pointer; }
form { max-width:800px; margin:10px auto; display:flex; gap:10px; }
input[type=text] { flex:1; padding:8px; border-radius:6px; border:1px solid #ccc; }
button { padding:8px 14px; border:none; border-radius:6px; background:#4caf50; color:#fff; font-weight:bold; cursor:pointer; }
.media { max-width:100%; margin-top:8px; border-radius:6px; }
.emoji-row { display:flex; flex-wrap:wrap; gap:5px; max-width:800px; margin:10px auto; }
.emoji-btn { cursor:pointer; font-size:20px; border:none; background:none; }
</style>
</head>
<body>
<div class="header">
    <div>WhatsApp – Közös nézet és válasz</div>
    <div class="clock" id="clock">--:--:--</div>
</div>
<div class="messages" id="messages"></div>
<form id="chatForm">
<input type="hidden" id="target" value="">
<input type="text" id="reply" placeholder="Írd ide az üzenetet..." required />
<button type="submit">Küldés</button>
</form>

<!-- Emoji külön sorok -->
<div class="emoji-row" id="emojiContainer"></div>

<script>
const messagesEl = document.getElementById('messages');
const targetInput = document.getElementById('target');
const replyInput = document.getElementById('reply');
const emojiContainer = document.getElementById('emojiContainer');
const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');

ws.onopen = () => console.log('WebSocket csatlakozott!');
ws.onerror = err => console.error('WebSocket hiba:', err);

// Óra
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');
    document.getElementById('clock').textContent = h + ':' + m + ':' + s;
}
setInterval(updateClock, 1000);
updateClock();

function addMessage(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'msg';
    wrap.dataset.from = msg.from;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (msg.name || msg.from) + ' @ ' + new Date(msg.t).toLocaleString();

    const replyBtn = document.createElement('button');
    replyBtn.textContent = 'Válasz';
    replyBtn.className = 'reply-btn';
    replyBtn.onclick = () => targetInput.value = msg.from;
    meta.appendChild(replyBtn);

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Törlés';
    delBtn.className = 'del-btn';
    delBtn.onclick = () => wrap.remove();
    meta.appendChild(delBtn);

    wrap.appendChild(meta);

    if (msg.text) wrap.appendChild(document.createTextNode(msg.text));
    if (msg.media && msg.media.data) {
        const img = document.createElement('img');
        img.src = "data:" + msg.media.mimetype + ";base64," + msg.media.data;
        img.className = "media";
        wrap.appendChild(img);
    }

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
    const text = replyInput.value.trim();
    const to = targetInput.value;
    if(!text || !to) { alert('Válaszd ki, kinek küldöd!'); return; }
    ws.send(JSON.stringify({ type:'send', payload: { to, text } }));
    replyInput.value = '';
});

// Emoji külön sorok
const emojiCategories = {
    "Smileys": ["😀","😃","😄","😁","😆","😅","😂","🤣","🥲","☺️","😊","😇","🙂","🙃","😉","😍","🥰","😘"],
    "Hearts": ["❤️","💔","💖","💙","💚","💛","💜","🖤"],
    "Gestures": ["👍","👎","👌","✌️","🤞","🤟","🤘","👏","🙏"]
};

for (const cat in emojiCategories) {
    emojiCategories[cat].forEach(e => {
        const btn = document.createElement('button');
        btn.textContent = e;
        btn.className = 'emoji-btn';
        btn.onclick = () => replyInput.value = e;
        emojiContainer.appendChild(btn);
    });
}
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Szerver fut: http://localhost:' + PORT));

client.initialize();
