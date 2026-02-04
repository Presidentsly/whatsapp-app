const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

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
        args: ['--no-sandbox','--disable-setuid-sandbox']
    }
});


// =======================
// WHATSAPP EVENTS
// =======================

client.on('qr', qr => {
    console.log("QR kód:");
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () =>
    console.log('WhatsApp session mentve!')
);

client.on('ready', () =>
    console.log('WhatsApp kliens csatlakozott!')
);

client.on('message', async msg => {
    try {

        const name = msg._data?.notifyName || msg.from;

        const item = {
            from: msg.from,
            name,
            text: msg.body,
            t: Date.now()
        };

        if(msg.hasMedia){
            const media = await msg.downloadMedia();
            if(media?.data){
                item.media = {
                    mimetype: media.mimetype,
                    data: media.data
                };
            }
        }

        if(!item.media){
            messages.push(item);
            if(messages.length>200) messages.shift();
        }

        broadcast({type:'message', payload:item});

    } catch(e){ console.error(e); }
});


// =======================
// WEBSOCKET
// =======================

wss.on('connection', socket => {

    console.log("🌐 Web kliens csatlakozott");

    socket.send(JSON.stringify({
        type:'history',
        payload: messages
    }));

    socket.on('message', async data => {

        try{
            const {type,payload} = JSON.parse(data);

            if(type==='send'){

                const {to,text} = payload;

                await client.sendMessage(to,text);

                const item = {
                    from:'Me',
                    name:'Te',
                    text,
                    t:Date.now()
                };

                messages.push(item);

                broadcast({type:'message',payload:item});
            }

        }catch(e){ console.error(e); }

    });

});

function broadcast(data){
    const json = JSON.stringify(data);
    wss.clients.forEach(s=>{
        if(s.readyState===WebSocket.OPEN)
            s.send(json);
    });
}


// =======================
// FRONTEND
// =======================

app.get('/', (req,res)=>{
res.sendFile(path.join(__dirname,'index.html'));
});


// =======================
// START
// =======================

const PORT = process.env.PORT || 3000;

server.listen(PORT,()=>{
    console.log("🚀 Server fut:",PORT);
});

client.initialize();
