// server/app.js
const os = require('os');
const path = require('path');
const express = require('express');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', routes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ToolYard server running at http://localhost:${PORT}`);
  getLanIps().forEach(ip => {
    console.log(`Phone / LAN URL:      http://${ip}:${PORT}`);
  });
});