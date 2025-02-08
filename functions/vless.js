const WebSocket = require('ws');
const net = require('net');

exports.handler = async (event, context) => {
  // 检查是否为 WebSocket 升级请求
  if (event.headers.upgrade !== 'websocket') {
    return { statusCode: 400, body: 'Not a WebSocket request' };
  }

  // 你的境外服务器的地址和端口（例如 Shadowsocks、V2Ray 服务器）
  const targetHost = 'your_remote_server_address'; // 替换为你的服务器地址
  const targetPort = 12345;                     // 替换为你的服务器端口

  const wss = new WebSocket.Server({ noServer: true });

  wss.on('connection', (ws) => {
    console.log('Client connected');

    // 创建到境外服务器的 TCP 连接
    const targetSocket = net.createConnection({
      host: targetHost,
      port: targetPort,
    });

     targetSocket.on('connect', ()=>{
        console.log('已连接到远程服务器')
     })

    // 将从境外服务器接收到的数据发送给客户端
    targetSocket.on('data', (data) => {
        try{
            if (ws.readyState === WebSocket.OPEN){
              ws.send(data);
            }
        }catch(err){
            console.error("向客户端发送数据出错:", err);
        }
    });

    // 将从客户端接收到的数据发送给境外服务器
    ws.on('message', (message) => {
      targetSocket.write(message);
    });

    // 处理客户端断开连接
    ws.on('close', () => {
      targetSocket.end();
      console.log('Client disconnected');
    });

    // 处理错误
    targetSocket.on('error', (err) => {
      console.error('Target socket error:', err);
      ws.close(); // 关闭 WebSocket 连接
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      targetSocket.end(); // 关闭到境外服务器的连接
    });
  });

  // 处理 WebSocket 升级请求 (关键部分)
  wss.handleUpgrade(event.request, event.request.socket, event.request.rawHeaders, (ws) => {
    wss.emit('connection', ws, event.request);
  });


    return {
      statusCode: 101, // Switching Protocols
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Accept': '', //ws 库会自动处理这个
      },
      body:''
    };
};

