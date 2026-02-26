const WebSocket = require('ws');
const admin = require('firebase-admin');
const express = require('express');

// 1. DUMMY SERVER FOR RENDER (Keeps the service alive)
const app = express();
app.get('/', (req, res) => res.send('Bot is Running'));
app.listen(process.env.PORT || 3000);

// 2. FIREBASE SETUP
// Using environment variables so you don't leak your keys on GitHub
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});
const db = admin.database();

// 3. BINARY PARSING (From your Duck Mod)
const readVarInt = (buf, off) => {
  let res = 0, shift = 0, bytes = 0;
  while (true) {
    const byte = buf[off + bytes++];
    res |= (byte & 127) << shift;
    if (!(byte & 128)) break;
    shift += 7;
  }
  return { val: res, len: bytes };
};

const readFloat32 = (buf, off) => {
  const view = new DataView(new ArrayBuffer(4));
  for (let i = 0; i < 4; i++) view.setUint8(i, buf[off + i]);
  return { val: view.getFloat32(0, true), len: 4 };
};

// 4. GAME LOGIC
let matchData = { samples: [], players: {}, startTime: Date.now() };
let entityMap = new Map();

function connect() {
  const ws = new WebSocket('wss://pucks.io/ws/'); // Change to your preferred server

  ws.on('message', (data) => {
    let offset = 0;
    const msgCode = data[offset++];

    if (msgCode === 6) { // Position Updates
      const sample = { t: Date.now() - matchData.startTime, players: [], ball: {} };
      
      // Read Ball
      const ballX = readFloat32(data, offset); offset += ballX.len;
      const ballZ = readFloat32(data, offset); offset += ballZ.len;
      sample.ball = { x: ballX.val, z: ballZ.val };

      // Read Players
      const pCount = readVarInt(data, offset); offset += pCount.len;
      for (let i = 0; i < pCount.val; i++) {
        const id = readVarInt(data, offset); offset += id.len;
        const x = readFloat32(data, offset); offset += x.len;
        const z = readFloat32(data, offset); offset += z.len;
        
        const playerInfo = entityMap.get(id.val);
        if (playerInfo) {
          sample.players.push({ id: id.val, name: playerInfo.name, team: playerInfo.team, x: x.val, z: z.val });
        }
      }

      // Live Broadcast to Firebase
      db.ref('live_match').set(sample);
      matchData.samples.push(sample);
    }

    if (msgCode === 11 || msgCode === 12) { // Goal or Game Reset
      if (matchData.samples.length > 50) {
        const matchId = `match_${Date.now()}`;
        db.ref(`replays/${matchId}`).set({
            ...matchData,
            duration: matchData.samples[matchData.samples.length-1].t
        });
      }
      matchData = { samples: [], players: {}, startTime: Date.now() };
    }
    
    // Logic for Codes 2, 3, 8 (Player Joins) would map entityMap here...
  });

  ws.on('close', () => setTimeout(connect, 5000));
}

connect();
