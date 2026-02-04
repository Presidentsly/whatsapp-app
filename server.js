const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const messages = [];
const authPath = path.join(__dirname, 'wwebjs_auth');

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'default', dataPath: authPath }),
    puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] }
});

// WhatsApp QR esemény
client.on('qr', async qr => {
    // ASCII QR a terminálba
    qrcodeTerminal.generate(qr, { small: true });
    console.log("QR kód ASCII-ban a terminálban");

    // PNG mentés webre
    await QRCode.toFile(path.join(__dirname,'public','qr.png'), qr, { width: 300 });
    console.log("QR kód mentve: public/qr.png");
});

client.on('authenticated', () => console.log('✅ WhatsApp session mentve!'));
client.on('ready', () => console.log('✅ WhatsApp kliens csatlakozott!'));

// WebSocket
wss.on('connection', socket => {
    console.log("🌐 Web kliens csatlakozott");
    socket.send(JSON.stringify({ type:'history', payload: messages }));

    socket.on('message', async data => {
        try {
            const { type, payload } = JSON.parse(data);
            if (type === 'send') {
                const { to, text } = payload;
                if(to && text){
                    await client.sendMessage(to, text);
                    const item = { from:'Me', name:'Te', text, t:Date.now() };
                    messages.push(item);
                    broadcast({type:'message', payload:item});
                }
            }
        } catch(e){ console.error(e); }
    });
});

function broadcast(data){
    const json = JSON.stringify(data);
    wss.clients.forEach(s=>{ if(s.readyState===WebSocket.OPEN) s.send(json); });
}

// Statikus fájlok (pl. qr.png)
app.use(express.static(path.join(__dirname,'public')));

// Frontend HTML
app.get('/', (req,res)=>{
    res.sendFile(path.join(__dirname,'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log(`🚀 Server fut: http://localhost:${PORT}`));

client.initialize();
