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
                        console.log('Elküldve:', text, '->', to);
                    }
                }
            } catch(err) { console.error(err); }
        });
    });

    // Bejövő üzenetek
    client.on('message', async msg => {
        try {
            const contact = await msg.getContact();
            const item = {
                from: msg.from,
                name: contact.pushname || contact.number,
                text: msg.body,
                t: Date.now()
            };

            // Média letöltés (képek, gif)
            if(msg.hasMedia) {
                const media = await msg.downloadMedia();
                if(media && media.data) {
                    item.media = {
                        mimetype: media.mimetype,
                        data: media.data
                    };
                }
            }

            messages.push(item);
            if(messages.length > 200) messages.shift();

            const data = JSON.stringify({ type:'message', payload: item });
            wss.clients.forEach(socket => {
                if(socket.readyState === WebSocket.OPEN) socket.send(data);
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
.messages { max-width:800px; margin:20px auto; padding:10px; background:#fff; border-radius:8px; height:60vh; overflow:auto; }
.msg { margin:10px 0; padding:8px 12px; background:#eef; border-radius:6px; }
.meta { font-size:12px; color:#666; margin-bottom:4px; }
.reply-btn { margin-left:10px; font-size:11px; padding:2px 6px; cursor:pointer; }
form { max-width:800px; margin:10px auto; display:flex; gap:10px; }
input[type=text] { flex:1; padding:8px; border-radius:6px; border:1px solid #ccc; }
button { padding:8px 14px; border:none; border-radius:6px; background:#4caf50; color:#fff; font-weight:bold; cursor:pointer; }
select { padding:5px; border-radius:6px; }
.media { max-width:100%; margin-top:8px; border-radius:6px; }
</style>
</head>
<body>

<!-- Fejléc és valós idő -->
<h2 style="text-align:center; display:flex; justify-content:space-between; align-items:center; max-width:800px; margin:20px auto;">
  <span>WhatsApp – Közös nézet és válasz</span>
  <span id="liveClock" style="color:#ffd106; font-weight:bold; font-family:monospace;">--:--</span>
</h2>

<div class="messages" id="messages"></div>
<form id="chatForm">
<input type="hidden" id="target" value="">
<input type="text" id="reply" placeholder="Írd ide az üzenetet..." required />
<button type="submit">Küldés</button>
</form>

<!-- Emoji legördülő -->
<div style="max-width:800px; margin:10px auto;">
<select id="emojiSelect">
    <option value="">😀 Emoji választás...</option>
</select>
</div>

<script>
const messagesEl = document.getElementById('messages');
const targetInput = document.getElementById('target');
const replyInput = document.getElementById('reply');
const emojiSelect = document.getElementById('emojiSelect');
const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');

ws.onopen = () => console.log('WebSocket csatlakozott!');
ws.onerror = err => console.error('WebSocket hiba:', err);

// Óra frissítése
function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2,'0');
    const minutes = now.getMinutes().toString().padStart(2,'0');
    document.getElementById('liveClock').textContent = \`\${hours}:\${minutes}\`;
}
setInterval(updateClock, 1000);
updateClock();

// Üzenetek hozzáadása
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

    // szöveg
    if(msg.text) {
        wrap.appendChild(document.createTextNode(msg.text));
    }

    // kép vagy gif
    if(msg.media && msg.media.data) {
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

// Emoji lista
const emojis = ["😀","😃","😄","😁","😆","😅","😂","🤣","🥲","☺️","😊","😇","🙂","🙃","😉","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳",
"❤️","💔","💖","💙","💚","💛","💜","🖤","👍","👎","👌","✌️","🤞","🤟","🤘","👏","🙏"];

emojis.forEach(emoji => {
    const option = document.createElement('option');
    option.value = emoji;
    option.textContent = emoji;
    emojiSelect.appendChild(option);
});

emojiSelect.addEventListener('change', e => {
    if(e.target.value) {
        replyInput.value = e.target.value;
        emojiSelect.value = "";
    }
});
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Szerver fut: http://localhost:' + PORT));

client.initialize();
