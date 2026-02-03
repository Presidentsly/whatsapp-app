const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

console.log("NODE VERSION:", process.version);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const messages = [];

const authPath = path.join('/tmp', 'wwebjs_auth_safe');

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'default',
        dataPath: authPath
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ]
    }
});


// ===== DEBUG =====

client.on('qr', qr => {
    console.log('QR generálva');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('WhatsApp session mentve!');
});

client.on('ready', () => {
    console.log('WhatsApp kliens csatlakozott!');
});

client.on('loading_screen', (p, msg) => {
    console.log('Betöltés:', p, msg);
});

client.on('change_state', state => {
    console.log('Állapot:', state);
});

client.on('auth_failure', msg => {
    console.log('AUTH HIBA:', msg);
});

client.on('disconnected', reason => {
    console.log('Lecsatlakozott:', reason);
});


// ===== WEBSOCKET =====

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
                        from:'Me',
                        name:'Te',
                        text,
                        t:Date.now()
                    };

                    messages.push(item);
                    if(messages.length > 200) messages.shift();

                    const sendData = JSON.stringify({ type:'message', payload:item });

                    wss.clients.forEach(s => {
                        if(s.readyState === WebSocket.OPEN)
                            s.send(sendData);
                    });
                }
            }

        } catch(err) {
            console.error('WS HIBA:', err);
        }
    });
});


// ===== BEJÖVŐ WHATSAPP ÜZENET =====

client.on('message', async msg => {

    try {

        const name = msg._data?.notifyName || msg.from;

        const item = {
            from: msg.from,
            name,
            text: msg.body,
            t: Date.now()
        };

        if(msg.hasMedia) {
            const media = await msg.downloadMedia();

            if(media?.data) {
                item.media = {
                    mimetype: media.mimetype,
                    data: media.data
                };
            }
        }

        if(!item.media) {
            messages.push(item);
            if(messages.length > 200) messages.shift();
        }

        const sendData = JSON.stringify({ type:'message', payload:item });

        wss.clients.forEach(socket => {
            if(socket.readyState === WebSocket.OPEN)
                socket.send(sendData);
        });

    } catch(err) {
        console.error('MESSAGE HIBA:', err);
    }

});


// ===== FRONTEND =====

app.get('/', (req,res) => {
res.setHeader('Content-Type', 'text/html; charset=utf-8');

res.send(`<!doctype html>
<html lang="hu">
<body>

<h2>WhatsApp Chat</h2>
<div id="messages"></div>

<input id="target" placeholder="telefonszám@c.us">
<input id="reply" placeholder="üzenet">
<button onclick="send()">Küldés</button>

<script>

const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');
const messagesEl = document.getElementById('messages');

function add(m){
    const d=document.createElement('div');
    d.innerText=(m.name||m.from)+': '+(m.text||'[media]');
    messagesEl.appendChild(d);
}

ws.onmessage = ev => {
    const {type,payload} = JSON.parse(ev.data);
    if(type==='history') payload.forEach(add);
    if(type==='message') add(payload);
}

function send(){
    ws.send(JSON.stringify({
        type:'send',
        payload:{
            to:document.getElementById('target').value,
            text:document.getElementById('reply').value
        }
    }));
}

</script>
</body>
</html>`);
});


// ===== SERVER =====

const PORT = process.env.PORT || 3000;

server.listen(PORT,()=>console.log('Szerver fut:',PORT));

client.initialize();
