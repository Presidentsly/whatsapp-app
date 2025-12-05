const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);

// WebSocket ugyanazon a porton
const wss = new WebSocket.Server({ server, path: '/ws' });

const messages = [];

// WhatsApp Web.js kliens Render Worker-kompatibilis Puppeteerrel
const client = new Client({
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    authStrategy: new LocalAuth({
        clientId: 'shared',
        dataPath: './wwebjs_auth_safe'
    })
});

// QR kód csak ha nincs session
client.on('qr', qr => {
    console.log("ÚJ QR KÓD! Olvasd be:");
    qrcode.generate(qr, { small: true });
});

// Session mentve
client.on('authenticated', () => {
    console.log("WhatsApp: Session mentve!");
});

// WhatsApp ready
client.on('ready', () => {
    console.log("WhatsApp: Csatlakozva!");

    // WebSocket kapcsolat
    wss.on('connection', socket => {
        console.log("WebSocket kliens csatlakozott");

        // Küldjük az üzenet előzményt
        socket.send(JSON.stringify({ type: 'history', payload: messages }));

        socket.on('message', async data => {
            try {
                const { type, payload } = JSON.parse(data);
                if(type === 'send'){
                    const { to, text } = payload;
                    if(to && text){
                        // Üzenet küldése WhatsApp-ra
                        await client.sendMessage(to, text);

                        const item = {
                            from: 'Me',
                            name: 'Te',
                            text,
                            t: Date.now()
                        };

                        messages.push(item);
                        if(messages.length > 200) messages.shift();

                        const out = JSON.stringify({ type:'message', payload:item });
                        wss.clients.forEach(ws => {
                            if(ws.readyState === WebSocket.OPEN)
                                ws.send(out);
                        });
                    }
                }
            } catch(err){
                console.error("WS hiba:", err);
            }
        });
    });

    // Bejövő WhatsApp üzenetek
    client.on('message', async msg => {
        try {
            const item = {
                from: msg.from,
                name: msg._data.notifyName || msg._data.pushname || msg.from,
                text: msg.body,
                t: Date.now()
            };

            if(msg.hasMedia){
                const media = await msg.downloadMedia();
                if(media && media.data){
                    item.media = {
                        mimetype: media.mimetype,
                        data: media.data
                    };
                }
            }

            messages.push(item);
            if(messages.length > 200) messages.shift();

            const out = JSON.stringify({ type:'message', payload:item });
            wss.clients.forEach(ws => {
                if(ws.readyState === WebSocket.OPEN)
                    ws.send(out);
            });

        } catch(e){
            console.error("WhatsApp msg hiba:", e);
        }
    });
});

// REST API
app.get('/api/messages', (req, res) => {
    res.json(messages);
});

// Egyszerű frontend (QR csak konzolon)
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send("<h1>WhatsApp fut Render Worker-en</h1><p>Nézd a konzolt a QR kódért.</p>");
});

// 10000 port Render Worker-kompatibilis
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Szerver fut a ${PORT}-es porton`));

// Kliens inicializálása (csak egyszer!)
client.initialize();
