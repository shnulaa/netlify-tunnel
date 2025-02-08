const WebSocket = require('ws');
const net = require('net');
const crypto = require('crypto');
const { URL } = require('url'); // 导入 URL 类

// 使用 Netlify 的原生日志
function log(message, data = '') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    if (data) {
        console.log(logMessage, JSON.stringify(data));
    } else {
        console.log(logMessage);
    }
}

// VLESS 协议配置
const userID = "86c50e3a-5b87-49dd-bd20-03c7f2735e40"; // 替换为你的 UUID
const hostName = process.env.URL || 'tunnel-liuyq.netlify.app'; // 使用 Netlify 域名

if (!isValidUUID(userID)) {
    throw new Error("uuid is not valid");
}

exports.handler = async (event, context) => {
    log('Request received', { path: event.path, method: event.httpMethod });

    try {
        // 处理 WebSocket 升级请求
        if (event.headers.upgrade && event.headers.upgrade.toLowerCase() === 'websocket') {
            log('WebSocket upgrade request received');

            const wss = new WebSocket.Server({ noServer: true });

            wss.on('connection', async (ws, req) => {
                log('WebSocket connected');

                let targetSocket; // 存储到目标服务器的连接

                ws.on('message', async (message) => {
                    log('WebSocket message received', message.length);

                    try {
                        const header = parseVLESSHeader(message);
                        log('VLESS header parsed:', header);

                        if (header.error) {
                            log('Invalid VLESS header:', header.error);
                            ws.close(1003, header.error); // 使用正确的 WebSocket 关闭码
                            return;
                        }

                        if (header.uuid !== userID) {
                            log('Invalid UUID:', header.uuid);
                            ws.close(1003, 'Invalid UUID');
                            return;
                        }

                        log(`Connecting to ${header.address}:${header.port}`);

                        // 发送 VLESS 响应
                        const response = buildVLESSResponse(header.version);
                        ws.send(response);
                        log('VLESS response sent');

                        // 创建到目标服务器的连接 (只在首次消息时创建)
                        if (!targetSocket) {
                            targetSocket = net.createConnection({
                                host: header.address,
                                port: header.port,
                            }, () => {
                                log(`Connected to ${header.address}:${header.port}`);
                                // 将首次消息中 VLESS 头之后的数据发送给目标服务器
                                if (header.data) {
                                    targetSocket.write(header.data);
                                    log(`Sent initial data to ${header.address}:${header.port}`);
                                }
                            });

                            targetSocket.on('data', (data) => {
                                //log(`Received data from target: ${data.length} bytes`);
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(data);
                                }
                            });

                            targetSocket.on('end', () => {
                                log(`Connection to ${header.address}:${header.port} closed`);
                                ws.close();
                            });

                            targetSocket.on('error', (err) => {
                                log('Target socket error:', err.message);
                                ws.close(1002, 'Target socket error'); // 使用正确的 WebSocket 关闭码
                            });
                        } else {
                          // 后续消息直接转发
                          targetSocket.write(message)
                        }


                    } catch (err) {
                        log('Error handling message:', err.message);
                        ws.close(1002, 'Internal Error');
                    }
                });

                ws.on('error', (err) => {
                    log('WebSocket error:', err.message);
                    if (targetSocket) {
                        targetSocket.end();
                    }
                });

                ws.on('close', (code, reason) => {
                    log(`WebSocket closed, code: ${code}, reason: ${reason}`);
                    if (targetSocket) {
                        targetSocket.end();
                    }
                });
            });

            wss.on('error', (err) => {
                log('WebSocket server error:', err.message);
            });

            // 处理 WebSocket 升级 (关键部分)
            return handleWebSocketUpgrade(event, wss);

        } else { // 处理普通 HTTP 请求 (配置信息分发)
            const url = new URL(event.rawUrl);
            switch (url.pathname) {
                case `/${userID}`: {
                    const vlessConfig = getVLESSConfig(userID, hostName);
                    return {
                        statusCode: 200,
                        headers: { "Content-Type": "text/html;charset=utf-8" },
                        body: vlessConfig,
                    };
                }
                case `/${userID}/ty`: {
                    const tyConfig = gettyConfig(userID, hostName);
                    return {
                        statusCode: 200,
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: tyConfig,
                    };
                }
                case `/${userID}/cl`: {
                    const clConfig = getclConfig(userID, hostName);
                    return {
                        statusCode: 200,
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: clConfig,
                    };
                }
                case `/${userID}/sb`: {
                   const sbConfig = getsbConfig(userID,hostName)
                    return {
                      statusCode: 200,
                      headers: { "Content-Type": "application/json;charset=utf-8" },
                      body: sbConfig,
                    };
                }
                default:
                    return { statusCode: 404, body: 'Not Found' };
            }
        }
    } catch (err) {
        log('Error in handler', { error: err.message, stack: err.stack });
        return { statusCode: 500, body: 'Internal Server Error' };
    }
};

// 解析 VLESS 协议头
function parseVLESSHeader(buffer) {
  try {
    let offset = 0;
    const version = buffer[offset++];
    const uuid = buffer.slice(offset, offset + 16).toString('hex');
    offset += 16;
    const additionLength = buffer.readUInt16BE(offset);
    offset += 2;
    //跳过附加字段
    offset += additionLength;

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
        address = buffer.slice(offset, offset + 16).toString('hex'); // 格式化为 hex
        offset += 16;
        break;
      default:
        return { error: 'Invalid address type' };
    }
    // 剩余数据
    const data = buffer.slice(offset)
    return { version, uuid, command, port, address, data};
  } catch (err) {
    return { error: 'Header parsing error: ' + err.message };
  }
}

// 构建 VLESS 响应
function buildVLESSResponse(version) {
    return Buffer.from([version, 0]); // VLESS 响应通常是版本号 + 0
}

// 获取 VLESS 配置信息
function getVLESSConfig(userID, host) {
    const vlessws = `vless://${userID}@${host}:443?encryption=none&security=none&type=ws&host=${host}&path=%2F#${host}`;
    const vlesswstls = `vless://${userID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&sni=${host}&fp=random&path=%2F#${host}`;
    const note = `Netlify VLESS 代理服务\n当前域名: ${host}`;
    const ty = `https://${host}/${userID}/ty`;
    const cl = `https://${host}/${userID}/cl`;
     const sb = `https://${host}/${userID}/sb`;

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

// 通用订阅配置 (简化版)
function gettyConfig(userID, host) {
  const vless = `vless://${userID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=%2F#${host}`
  return  Buffer.from(vless).toString('base64');
}

// Clash 订阅配置 (简化版)
function getclConfig(userID, host) {
    const proxy = {
        name: host,
        type: 'vless',
        server: host,
        port: 443,
        uuid: userID,
        alterId: 0,
        cipher: 'none',
        tls: true,
        'skip-cert-verify': true, // 如果 Netlify 证书有效，可以去掉这一行
        servername: host,
        network: 'ws',
        'ws-opts': {
          path: '/',
          headers: {
            Host: host
          }
        },
    'udp':true
    };

    const proxyGroup = {
      name: 'VLESS Proxy',
      type: 'select', // 或者 'url-test', 'fallback' 等
      proxies: [host] // 包含上面定义的 proxy 的 name
    }
    const config = {
        proxies: [proxy],
        'proxy-groups': [proxyGroup],
         rules: [
          'MATCH,VLESS Proxy' // 简单的规则，所有流量走代理
        ]
    };
  return  Buffer.from(YAML.stringify(config)).toString('base64');;
}

// 生成 sing-box 配置
function getsbConfig(userID, host) {
  const outbounds = [
    {
      type: 'vless',
      tag: 'vless-ws-tls',
      server: host,
      server_port: 443,
      uuid: userID,
      network: 'ws',
      tls: {
        enabled: true,
        server_name: host,
        insecure: true, // 如果 Netlify 证书有效，可以去掉这一行
      },
      ws: {
        path: '/',
        headers: {
          Host: host,
        },
      },
    },
    {
      "type": "direct",
      "tag": "direct"
    },
     {
      "type": "block",
      "tag": "block"
    }
  ];

   const route = {
    rules: [
      {
        "protocol": "dns",
        "outbound": "dns-out"
      },
      {
        "outbound": "direct",
        "port": [
          "0-65535"
        ]
      }
    ],
    "auto_detect_interface": true
  };

  const config = {
    outbounds: outbounds,
    route:route
  };

  return JSON.stringify(config, null, 2);
}
// 处理 WebSocket 升级
async function handleWebSocketUpgrade(event, wss) {
    const key = event.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');

    return {
        statusCode: 101,
        headers: {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
            'Sec-WebSocket-Accept': accept,
             // 可以添加其他必要的头, 例如 Sec-WebSocket-Protocol
        },
    };
}

// 验证 UUID
function isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

