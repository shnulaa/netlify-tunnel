const WebSocket = require('ws');
const crypto = require('crypto');

// VLESS 协议配置
const userID = "8d4a8f38-2d9c-4e3d-b35e-90c01872c61d"; // 替换为你的 UUID
const hostName = "tunnel-liuyq.netlify.app"; // 替换为你的域名

exports.handler = async (event, context) => {
  try {
    // 检查是否为 WebSocket 请求
    if (event.headers.upgrade !== 'websocket') {
      const vlessConfig = getVLESSConfig(userID, event.headers.host);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: vlessConfig
      };
    }

    // 创建 WebSocket 服务器
    const wss = new WebSocket.Server({ noServer: true });

    // 处理 WebSocket 连接
    wss.on('connection', handleVLESSConnection);

    // 处理 WebSocket 升级
    return await handleWebSocketUpgrade(event, wss);

  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

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

// 获取 VLESS 配置信息
function getVLESSConfig(userID, host) {
  const config = {
    protocol: 'vless',
    uuid: userID,
    address: host,
    port: 443,
    encryption: 'none',
    flow: '',
    network: 'ws',
    security: 'tls',
    path: '/vless',
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <title>VLESS Configuration</title>
</head>
<body>
  <h2>VLESS Configuration</h2>
  <pre>${JSON.stringify(config, null, 2)}</pre>
  <p>VLESS URL: vless://${userID}@${host}:443?encryption=none&security=tls&type=ws&path=/vless#${host}</p>
</body>
</html>
  `;
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

