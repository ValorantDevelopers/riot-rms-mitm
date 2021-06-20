const highlight = require('cli-highlight').highlight;
const {gzip, ungzip} = require('node-gzip');
const compression = require('compression');
const connect = require('connect');
const axios = require('axios');
const http = require('http');
const tls = require('tls');
const fs = require('fs');

const host = '127.0.0.1';
const port = 8000;
const rmsPort = 443;

const app = connect();

var remoteHostsMapping = {};

const requestListener = async (request, response) => {
  request.headers.host = 'clientconfig.rpg.riotgames.com';

  let query = await axios.get('https://clientconfig.rpg.riotgames.com' + request.url, {
    headers: request.headers
  });

  delete query.headers['content-length'];

  console.log(request.method, request.url);

  if (typeof query.data == 'object') {
    let object = query.data;

    if (object['rms.affinities']) {
      let start = 1;
      Object.keys(object['rms.affinities']).forEach(affinity => {
        remoteHostsMapping[start + ''] = object['rms.affinities'][affinity];
        object['rms.affinities'][affinity] = 'ws://127.0.0.' + start++;
      });

      object['rms.host'] = '127.0.0.1';
      object['rms.port'] = rmsPort;
      object['rms.allow_bad_cert.enabled'] = true;

      /*000000.761| ALWAYS| SDK: riot-messaging-service: client-config public value received: rms.allow_bad_cert.enabled = false
        000000.761| ALWAYS| SDK: riot-messaging-service: client-config public value received: rms.handshake_timeout_ms = 5000
        000000.761| ALWAYS| SDK: riot-messaging-service: client-config public value received: rms.heartbeat_interval_seconds = 55
        000000.761| ALWAYS| SDK: riot-messaging-service: client-config public value received: rms.host = wss://unconfigured.edge.rms.si.riotgames.com
        000000.761| ALWAYS| SDK: riot-messaging-service: client-config public value received: rms.max_reconnect_delay_ms = 300000
        000000.761| ALWAYS| SDK: riot-messaging-service: client-config public value received: rms.min_reconnect_delay_ms = 100
        000000.761| ALWAYS| SDK: riot-messaging-service: client-config public value received: rms.port = 443
        000000.761| ALWAYS| SDK: riot-messaging-service: client-config public value received: rms.protocol_preference = ipv4
        000000.761| ALWAYS| SDK: riot-messaging-service: client-config public value received: rms.socket_timeout_ms = 30000*/
    }
  }

  response.writeHead(query.status, query.headers).end(typeof query.data === 'object' ? JSON.stringify(query.data) : query.data);
};

app.use(requestListener);

app.use(compression());

http.createServer(app).listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
});

const WebSocket = require('ws');

const wsServer = new WebSocket.Server({ port: rmsPort });

wsServer.on('connection', (ws, req) => {
  let targetHostname = remoteHostsMapping[(req.headers.host.split(':')[0].split('127.0.0.')[1])];
  console.log('proxy to', targetHostname);

  delete req.headers['host'];
  delete req.headers['upgrade'];
  delete req.headers['connection'];
  delete req.headers['sec-websocket-key'];
  delete req.headers['origin'];

  ws.targetWsBuffer = [];

  ws.targetWs = new WebSocket(targetHostname + req.url, {
    headers: req.headers
  });

  ws.targetWs.on('open', () => {
    if (ws.targetWsBuffer.length > 0) {
      ws.targetWsBuffer.forEach(wsMessage => {
        ws.targetWs.send(wsMessage);
      });
      ws.targetWsBuffer = [];
    }
  });

  ws.targetWs.on('message', async (message) => {
    logMessage(message, false);
    ws.send(message);
  });

  ws.on('message', async (message) => {
    logMessage(message, true);

    if (ws.targetWs.readyState === WebSocket.OPEN) {
      ws.targetWs.send(message);
    } else {
      ws.targetWsBuffer.push(message);
    }
  });
});

async function logMessage(message, isOutgoing) {
  var displayMessage = message;
  var isGzipped = false;

  if (Buffer.isBuffer(message)) {
    if (message[0] == 0x1F && message[1] == 0x8B && message[2] == 0x08) {
      displayMessage = await ungzip(message);
      isGzipped = true;
    }
  }

  console.log('[' + (isOutgoing ? 'outgoing' : 'incoming') + (isGzipped ? '/gzip' : '') + ']', highlight(displayMessage.toString(), {language: 'json', ignoreIllegals: true}));
}