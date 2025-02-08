const WebSocket = require('ws');
const crypto = require('crypto');
const net = require('net');

// VLESS 协议配置
const userID = "86c50e3a-5b87-49dd-bd20-03c7f2735e40"; // 替换为你的 UUID
// 移除 Cloudflare 相关的 CDN IP 配置
const hostName = process.env.URL || 'tunnel-liuyq.netlify.app'; // 使用 Netlify 域名

if (!isValidUUID(userID)) {
  throw new Error("uuid is not valid");
}

exports.handler = async (event, context) => {
  try {
    const url = new URL(event.rawUrl);
    // 检查是否为 WebSocket 请求
    if (!event.headers.upgrade || event.headers.upgrade !== "websocket") {
      switch (url.pathname) {
        case `/${userID}`: {
          const vlessConfig = getVLESSConfig(userID, event.headers.host);
          return {
            statusCode: 200,
            headers: { "Content-Type": "text/html;charset=utf-8" },
            body: vlessConfig
          };
        }
        case `/${userID}/ty`: {
          const tyConfig = gettyConfig(userID, event.headers.host);
          return {
            statusCode: 200,
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: tyConfig
          };
        }
        case `/${userID}/cl`: {
          const clConfig = getclConfig(userID, event.headers.host); 
          return {
            statusCode: 200,
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: clConfig
          };
        }
        case `/${userID}/sb`: {
          const sbConfig = getsbConfig(userID, event.headers.host);
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json;charset=utf-8" },
            body: sbConfig
          };
        }
        default:
          return { statusCode: 404, body: 'Not Found' };
      }
    }

    // WebSocket 连接处理
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    // 设置 WebSocket 处理器
    setupWebSocket(server, url);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });

  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

// 添加详细日志
function setupWebSocket(ws, url) {
  let address = "";
  let portWithRandomLog = "";

  const log = (info, event) => {
    console.log(`[${address}:${portWithRandomLog}] ${info}`, event || "");
    // Netlify 会收集 console.log 的输出
  };

  // 添加更多关键点的日志
  ws.addEventListener('message', (event) => {
    log('Received message', event.data);
  });

  ws.addEventListener('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.addEventListener('close', () => {
    log('WebSocket closed');
  });

  // 创建可读流
  const readableStream = new ReadableStream({
    start(controller) {
      ws.addEventListener('message', (event) => {
        const message = event.data;
        controller.enqueue(message);
      });

      ws.addEventListener('close', () => {
        controller.close();
      });

      ws.addEventListener('error', (err) => {
        controller.error(err);
      });
    },
  });

  // 处理 VLESS 协议数据
  readableStream.pipeTo(new WritableStream({
    async write(chunk) {
      const {
        hasError,
        message,
        portRemote = 443,
        addressRemote = "",
        rawDataIndex,
        vlessVersion = new Uint8Array([0, 0]),
        isUDP,
      } = await processVLESSHeader(chunk, userID);

      if (hasError) {
        throw new Error(message);
      }

      address = addressRemote;
      portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? "udp " : "tcp "}`;

      const vlessResponseHeader = new Uint8Array([vlessVersion[0], 0]);
      const rawClientData = chunk.slice(rawDataIndex);

      // 处理数据传输
      if (isUDP && portRemote === 53) {
        // DNS 查询处理
        handleUDPDNS(ws, vlessResponseHeader, rawClientData);
      } else {
        // TCP 连接处理
        handleTCPConnection(ws, addressRemote, portRemote, rawClientData, vlessResponseHeader);
      }
    }
  })).catch((err) => {
    console.error('Stream processing error:', err);
    ws.close();
  });
}

// 在关键函数中添加日志
async function handleTCPConnection(ws, address, port, data, responseHeader) {
  console.log(`Attempting connection to ${address}:${port}`);
  
  const socket = net.createConnection({
    host: address,
    port: port
  });

  socket.on('connect', () => {
    console.log(`Successfully connected to ${address}:${port}`);
    ws.send(responseHeader);
    socket.write(data);
  });

  socket.on('data', (chunk) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    }
  });

  socket.on('end', () => ws.close());
  socket.on('error', (err) => {
    console.error('Socket error:', err);
    ws.close();
  });

  ws.on('message', (msg) => socket.write(msg));
  ws.on('close', () => socket.end());
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    socket.end();
  });
}

// 处理 VLESS 协议连接
function handleVLESSConnection(ws) {
  console.log('New VLESS connection');

  ws.on('message', async (message) => {
    try {
      // 解析 VLESS 协议头
      const {
        version,
        uuid,
        command,
        port,
        address,
        error
      } = parseVLESSHeader(message);

      if (error) {
        console.error('Invalid VLESS header:', error);
        ws.close();
        return;
      }

      // 验证 UUID
      if (uuid !== userID) {
        console.error('Invalid UUID');
        ws.close();
        return;
      }

      // 发送 VLESS 响应
      const response = buildVLESSResponse(version);
      ws.send(response);

      // 处理后续数据传输
      handleDataTransfer(ws, command, address, port);

    } catch (err) {
      console.error('Error handling message:', err);
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('VLESS connection closed');
  });
}

// 解析 VLESS 协议头
function parseVLESSHeader(buffer) {
  try {
    let offset = 0;
    const version = buffer[offset++];
    const uuid = buffer.slice(offset, offset + 16).toString('hex');
    offset += 16;
    
    const command = buffer[offset++];
    const port = buffer.readUInt16BE(offset);
    offset += 2;

    const addressType = buffer[offset++];
    let address = '';

    switch (addressType) {
      case 1: // IPv4
        address = buffer.slice(offset, offset + 4).join('.');
        offset += 4;
        break;
      case 2: // 域名
        const domainLength = buffer[offset++];
        address = buffer.slice(offset, offset + domainLength).toString();
        offset += domainLength;
        break;
      case 3: // IPv6
        address = buffer.slice(offset, offset + 16).toString('hex');
        offset += 16;
        break;
      default:
        return { error: 'Invalid address type' };
    }

    return { version, uuid, command, port, address };
  } catch (err) {
    return { error: err.message };
  }
}

// 构建 VLESS 响应
function buildVLESSResponse(version) {
  return Buffer.from([version, 0]);
}

// 处理数据传输
function handleDataTransfer(ws, command, address, port) {
  // 根据命令类型处理数据传输
  switch (command) {
    case 1: // TCP
      handleTCPTransfer(ws, address, port);
      break;
    case 2: // UDP
      handleUDPTransfer(ws, address, port);
      break;
    default:
      console.error('Unsupported command:', command);
      ws.close();
  }
}

// 处理 TCP 数据传输
function handleTCPTransfer(ws, address, port) {
  // 直接连接目标地址,不使用代理
  const targetSocket = net.createConnection({
    host: address,
    port: port 
  });

  targetSocket.on('connect', () => {
    console.log(`Connected to ${address}:${port}`);
  });

  targetSocket.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  targetSocket.on('end', () => {
    ws.close();
  });

  targetSocket.on('error', (err) => {
    console.error('Target socket error:', err);
    ws.close();
  });

  ws.on('message', (message) => {
    targetSocket.write(message);
  });

  ws.on('close', () => {
    targetSocket.end();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    targetSocket.end();
  });
}

// 获取 VLESS 配置信息
function getVLESSConfig(userID, host) {
  // 直接使用 Netlify 域名
  const vlessws = `vless://${userID}@${host}:443?encryption=none&security=none&type=ws&host=${host}&path=%2F%3Fed%3D2560#${host}`;
  const vlesswstls = `vless://${userID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&sni=${host}&fp=random&path=%2F%3Fed%3D2560#${host}`;
  
  const note = `Netlify VLESS 代理服务\n当前域名: ${host}`;
  const ty = `https://${host}/${userID}/ty`;
  const cl = `https://${host}/${userID}/cl`;
  const sb = `https://${host}/${userID}/sb`;

  // 返回配置页面 HTML
  return `
<!DOCTYPE html>
<html>
<head>
  <title>VLESS Configuration</title>
  <meta charset="utf-8">
</head>
<body>
  <h2>VLESS 配置信息</h2>
  <p>${note.replace(/\n/g, '<br>')}</p>
  <h3>WebSocket (无 TLS)</h3>
  <pre>${vlessws}</pre>
  <h3>WebSocket + TLS</h3>
  <pre>${vlesswstls}</pre>
  <h3>订阅链接</h3>
  <p>通用订阅: <a href="${ty}">${ty}</a></p>
  <p>Clash 订阅: <a href="${cl}">${cl}</a></p>
  <p>Sing-box 订阅: <a href="${sb}">${sb}</a></p>
</body>
</html>
`;
}

// 添加新的配置生成函数
function gettyConfig(userID, host) {
  const vlessshare = btoa(`vless://${userID}@${IP1}:${PT1}?encryption=none&security=none&fp=randomized&type=ws&host=${host}&path=%2F%3Fed%3D2560#CF_V1_${IP1}_${PT1}\n...`);
  return vlessshare;
}

function getclConfig(userID, host) {
  // ...clash config generation code...
}

function getsbConfig(userID, host) {
  // ...sing-box config generation code...
}

// 处理 WebSocket 升级
async function handleWebSocketUpgrade(event, wss) {
  const headers = {
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    'Sec-WebSocket-Accept': crypto
      .createHash('sha1')
      .update(event.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')
  };

  return {
    statusCode: 101,
    headers,
    body: ''
  };
}

// 验证 UUID
function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

function isValidIP(ip) {
  const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipRegex.test(ip);
}

