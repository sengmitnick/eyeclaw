/**
 * Rokid SSE Proxy - Node.js version
 * 
 * 架构：
 * 1. 接收Rokid客户端的SSE请求 (POST /sse/rokid)
 * 2. 调用Rails API触发OpenClaw处理
 * 3. 通过ActionCable WebSocket订阅实时stream chunks
 * 4. 将接收到的chunks实时通过SSE发送给客户端
 * 
 * 优势：
 * - 完全控制SSE流，没有缓冲问题
 * - 可以处理长连接和心跳
 * - 本地开发调试方便
 */

const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { URL } = require('url');

// 配置
const config = {
  port: process.env.PORT || 8787,
  railsWsUrl: process.env.RAILS_WS_URL || 'ws://localhost:3000/cable',
  railsHttpUrl: process.env.RAILS_HTTP_URL || 'http://localhost:3000'
};

// 带时间戳的日志函数
const logger = {
  log(...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}]`, ...args);
  },
  error(...args) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}]`, ...args);
  }
};

logger.log(`🚀 Rokid SSE Worker starting...`);
logger.log(`   Port: ${config.port}`);
logger.log(`   Rails WS: ${config.railsWsUrl}`);
logger.log(`   Rails HTTP: ${config.railsHttpUrl}`);

// 创建HTTP服务器
const server = http.createServer(handleRequest);

// 处理SSE请求
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${config.port}`);
  
  // 只处理 /sse/rokid 路径
  if (url.pathname !== '/sse/rokid' || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }
  
  try {
    // 解析请求body
    const body = await getRequestBody(req);
    const { message_id, agent_id, message, user_id, metadata, bot_id } = body;
    
    // 验证必填参数
    if (!message_id || !agent_id || !message || !Array.isArray(message)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing required parameters');
      return;
    }
    
    // 获取Authorization header
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Missing Authorization header');
      return;
    }
    
    // 第二步：建立WebSocket连接到ActionCable，订阅RokidStreamChannel接收流数据
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    
    // 立即发送响应头，防止缓冲
    res.flushHeaders();
    
    // 发送SSE注释确认连接
    res.write(': connected\n\n');
    
    const accessKey = authHeader.substring(7);
    
    // ========== 测试模式：注释掉真实的trigger请求，使用定时器测试SSE流 ==========
    logger.log('[Server] 🧪 TEST MODE: Starting interval test...');
    
    // 测试：每秒发送一次数据，持续10秒
    let counter = 0;
    const testInterval = setInterval(() => {
      counter++;
      const data = {
        role: 'agent',
        type: 'answer',
        answer_stream: `测试数据片段 #${counter} - 当前时间：${new Date().toLocaleTimeString()}`,
        message_id: message_id,
        agent_id: agent_id,
        is_finish: false
      };
      
      sendSse(res, 'message', data);
      logger.log(`[Server] 📤 Test chunk #${counter} sent`);
      
      // 10秒后结束
      if (counter >= 10) {
        clearInterval(testInterval);
        
        // 发送结束标记
        sendSse(res, 'message', {
          role: 'agent',
          type: 'answer',
          answer_stream: '',
          message_id: message_id,
          agent_id: agent_id,
          is_finish: true
        });
        
        sendSse(res, 'done', {
          role: 'agent',
          type: 'answer',
          message_id: message_id,
          agent_id: agent_id,
          is_finish: true
        });
        
        logger.log('[Server] ✅ Test completed, closing connection');
        res.end();
      }
    }, 1000);
    
    // 客户端断开连接时清理
    res.on('close', () => {
      clearInterval(testInterval);
      logger.log('[Server] ❌ Client disconnected, interval cleared');
    });
    
    /* ===== 原始代码已注释，测试完成后取消注释 =====
    // 第一步：通过HTTP API触发Rails后端（使用 /api/rokid/trigger）
    let triggerResponse;
    try {
      triggerResponse = await httpRequest({
        method: 'POST',
        url: `${config.railsHttpUrl}/api/rokid/trigger`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessKey}`
        },
        body: JSON.stringify({
          message_id,
          agent_id,
          message,
          user_id,
          metadata,
          bot_id
        })
      });
    } catch (triggerError) {
      logger.error('[Server] Trigger API request failed:', triggerError.message);
      sendSse(res, 'error', {
        message: `Failed to connect to backend: ${triggerError.message}`
      });
      res.end();
      return;
    }
    
    if (!triggerResponse.ok) {
      logger.error(`[Server] Trigger API error: ${triggerResponse.status} - ${triggerResponse.body}`);
      sendSse(res, 'error', {
        message: `Backend error (${triggerResponse.status}): ${triggerResponse.body}`
      });
      res.end();
      return;
    }
    
    const triggerData = JSON.parse(triggerResponse.body);
    const botIdResolved = triggerData.bot_id;
    const sessionId = triggerData.session_id;
    
    logger.log(`[Server] Triggered: bot_id=${botIdResolved}, session_id=${sessionId}`);
    
    // 第二步：通过 WebSocket 接收流数据
    await handleActionCableStream(
      accessKey,
      botIdResolved,
      sessionId,
      res
    );
    ===== */
    
  } catch (error) {
    logger.error('[Server] Unhandled error:', error.message);
    // 如果响应头未发送，尝试发送错误
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal error: ${error.message}`);
    } else {
      // 响应头已发送，通过SSE发送错误
      try {
        sendSse(res, 'error', { message: `Internal error: ${error.message}` });
        res.end();
      } catch (e) {
        logger.error('[Server] Failed to send error via SSE:', e.message);
      }
    }
  }
}

/**
 * 处理ActionCable WebSocket流
 * 订阅 RokidStreamChannel 接收流式响应
 */
async function handleActionCableStream(accessKey, botId, sessionId, sseRes) {
  return new Promise((resolve, reject) => {
    let ws = null;
    let pongInterval = null;
    
    try {
      // 建立WebSocket连接（带access_key参数）
      const wsUrl = `${config.railsWsUrl}?access_key=${encodeURIComponent(accessKey)}`;
      ws = new WebSocket(wsUrl);
      
      ws.on('open', () => {
        logger.log(`[Server] WebSocket connected to ${config.railsWsUrl}`);
        
        // ActionCable握手：订阅RokidStreamChannel接收流数据
        const subscribeCmd = {
          command: 'subscribe',
          identifier: JSON.stringify({
            channel: 'RokidStreamChannel',
            access_key: accessKey,
            bot_id: botId,
            session_id: sessionId
          })
        };
        
        ws.send(JSON.stringify(subscribeCmd));
        logger.log(`[Server] Subscribed to RokidStreamChannel: bot_id=${botId}, session_id=${sessionId}`);
        
        // 定期发送pong响应心跳
        pongInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        }, 3000);
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          // ActionCable ping
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          
          // 确认订阅
          if (message.type === 'confirm_subscription') {
            logger.log('[Server] Subscription confirmed');
            return;
          }
          
          // 接收实际数据
          if (message.message) {
            const msg = message.message;
            
            switch (msg.type) {
              case 'connected':
                logger.log('[Server] Channel connected');
                break;
                
              case 'stream_chunk':
                sendSse(sseRes, 'message', {
                  role: 'agent',
                  type: 'answer',
                  answer_stream: msg.content,
                  message_id: sessionId,
                  agent_id: botId,
                  is_finish: false
                });
                logger.log(`[Server] Chunk: "${msg.content}"`);
                break;
                
              case 'stream_end':
                sendSse(sseRes, 'message', {
                  role: 'agent',
                  type: 'answer',
                  answer_stream: '',
                  message_id: sessionId,
                  agent_id: botId,
                  is_finish: true
                });
                sendSse(sseRes, 'done', {
                  role: 'agent',
                  type: 'answer',
                  message_id: sessionId,
                  agent_id: botId,
                  is_finish: true
                });
                logger.log('[Server] Stream ended');
                cleanup();
                resolve();
                break;
                
              case 'stream_error':
                sendSse(sseRes, 'error', {
                  message: msg.error || 'Unknown error'
                });
                console.error(`[Server] Error: ${msg.error}`);
                cleanup();
                reject(new Error(msg.error));
                break;
                
              default:
                logger.log(`[Server] Unknown type: ${msg.type}`);
            }
          }
          
        } catch (parseError) {
          logger.error('[Server] Parse error:', parseError);
        }
      });
      
      ws.on('error', (error) => {
        logger.error('[Server] WebSocket error:', error.message);
        sendSse(sseRes, 'error', { message: 'WebSocket error' });
        cleanup();
        reject(error);
      });
      
      ws.on('close', () => {
        logger.log('[Server] WebSocket closed');
        cleanup();
        resolve();
      });
      
      // 清理函数
      function cleanup() {
        if (pongInterval) {
          clearInterval(pongInterval);
          pongInterval = null;
        }
        if (ws) {
          ws.close();
          ws = null;
        }
        try {
          sseRes.end();
        } catch (e) {}
      }
      
      // 超时保护：5分钟无活动断开
      setTimeout(() => {
        logger.log('[Server] Timeout, closing connection');
        cleanup();
        resolve();
      }, 10 * 60 * 1000);
      
    } catch (error) {
      logger.error('[Server] Failed to connect:', error);
      sendSse(sseRes, 'error', { message: 'Failed to connect to backend' });
      reject(error);
    }
  });
}

/**
 * 发送SSE事件
 */
function sendSse(res, event, data) {
  try {
    const timestamp = new Date().toISOString();
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // 立即 flush 数据，确保实时发送而不缓冲
    if (res.flush) {
      res.flush();
    }
    logger.log(`[Server] [${timestamp}] SSE sent: event=${event}, content=${data.answer_stream || 'N/A'}`);
  } catch (e) {
    // 忽略连接已关闭的错误（客户端断开时正常现象）
    if (e.message?.includes('finished loading') || e.code === 'ECONNRESET') {
      logger.log('[Server] SSE connection closed, ignoring write error');
    } else {
      logger.error('[Server] SSE write error:', e.message);
    }
  }
}

/**
 * 获取请求body
 */
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * HTTP请求封装
 */
function httpRequest({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    
    const options = {
      method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers
    };
    
    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body
        });
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 启动服务器
server.listen(config.port, () => {
  logger.log(`✅ Server running on http://localhost:${config.port}`);
  logger.log(`   Test: curl -N -X POST http://localhost:${config.port}/sse/rokid \\`);
  logger.log(`         -H "Content-Type: application/json" \\`);
  logger.log(`         -H "Authorization: Bearer YOUR_KEY" \\`);
  logger.log(`         -d '{"message_id":"test","agent_id":"1","message":[{"role":"user","content":"hi"}]}'`);
});
