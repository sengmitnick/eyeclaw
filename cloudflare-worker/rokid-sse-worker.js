/**
 * Cloudflare Worker: Rokid SSE Proxy
 * 
 * 架构：
 * 1. 接收Rokid客户端的SSE请求 (POST /sse/rokid)
 * 2. 调用Rails API触发OpenClaw处理
 * 3. 通过ActionCable WebSocket订阅实时stream chunks
 * 4. 将接收到的chunks实时通过SSE发送给Rokid客户端
 * 
 * 优势：
 * - 绕过Rails ActionController::Live的缓冲问题
 * - Workers的ReadableStream是真正的实时流
 * - 复用现有ActionCable基础设施（WebSocket真正实时）
 * 
 * 部署：
 * 1. 安装 wrangler: npm install -g wrangler
 * 2. 配置 wrangler.toml 设置环境变量 RAILS_BACKEND_URL, RAILS_HTTP_URL
 * 3. 部署: wrangler deploy
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 只处理 /sse/rokid 路径
    if (url.pathname !== '/sse/rokid' || request.method !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }
    
    try {
      // 解析请求body
      const body = await request.json();
      const { message_id, agent_id, message, user_id, metadata, bot_id } = body;
      
      // 验证必填参数
      if (!message_id || !agent_id || !message || !Array.isArray(message)) {
        return new Response('Missing required parameters', { status: 400 });
      }
      
      // 获取Authorization header
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response('Missing Authorization header', { status: 401 });
      }
      
      const accessKey = authHeader.substring(7);
      
      // 从环境变量读取配置
      const railsWsUrl = env.RAILS_WS_URL || 'wss://yourapp.com/cable';
      const railsHttpUrl = env.RAILS_HTTP_URL || 'https://yourapp.com';
      
      // 第一步：通过HTTP API触发Rails后端发送命令到OpenClaw
      const triggerResponse = await fetch(`${railsHttpUrl}/api/rokid/trigger`, {
        method: 'POST',
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
      
      if (!triggerResponse.ok) {
        const error = await triggerResponse.text();
        return new Response(`Backend error: ${error}`, { status: triggerResponse.status });
      }
      
      const triggerData = await triggerResponse.json();
      const botIdResolved = triggerData.bot_id;
      const sessionId = triggerData.session_id;
      
      // 第二步：建立WebSocket连接到ActionCable订阅实时数据
      // 创建SSE响应流
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      
      // 立即发送SSE注释确认连接
      await writer.write(encoder.encode(': connected\n\n'));
      
      // 异步处理WebSocket流
      handleActionCableStream(
        railsWsUrl,
        accessKey,
        botIdResolved,
        sessionId,
        writer,
        encoder
      );
      
      // 立即返回SSE响应（真正的流式响应）
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...CORS_HEADERS
        }
      });
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(`Internal error: ${error.message}`, { status: 500 });
    }
  }
};

/**
 * 处理ActionCable WebSocket流
 * 连接到Rails ActionCable，订阅RokidStreamChannel，实时接收chunks
 */
async function handleActionCableStream(wsUrl, accessKey, botId, sessionId, writer, encoder) {
  let ws = null;
  
  try {
    // 建立WebSocket连接
    ws = new WebSocket(wsUrl);
    
    // 等待连接建立
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    
    console.log(`[Worker] WebSocket connected to ${wsUrl}`);
    
    // ActionCable握手：订阅RokidStreamChannel
    const subscribeCommand = {
      command: 'subscribe',
      identifier: JSON.stringify({
        channel: 'RokidStreamChannel',
        access_key: accessKey,
        bot_id: botId,
        session_id: sessionId
      })
    };
    
    ws.send(JSON.stringify(subscribeCommand));
    console.log(`[Worker] Subscribed to RokidStreamChannel: bot_id=${botId}, session_id=${sessionId}`);
    
    // 监听消息
    ws.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // ActionCable ping（保持连接）
        if (data.type === 'ping') {
          // 必须响应 pong 以保持连接
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        
        // ActionCable确认消息
        if (data.type === 'confirm_subscription') {
          console.log('[Worker] Subscription confirmed');
          return;
        }
        
        // 接收实际的stream数据
        if (data.message) {
          const message = data.message;
          
          switch (message.type) {
            case 'connected':
              console.log('[Worker] Channel connected confirmation received');
              break;
              
            case 'stream_chunk':
              // 发送SSE message事件
              const chunkData = {
                role: 'agent',
                type: 'answer',
                answer_stream: message.content,
                message_id: sessionId,
                agent_id: botId,
                is_finish: false
              };
              
              await writer.write(encoder.encode(`event: message\n`));
              await writer.write(encoder.encode(`data: ${JSON.stringify(chunkData)}\n\n`));
              console.log(`[Worker] Forwarded chunk: "${message.content}"`);
              break;
              
            case 'stream_end':
              // 发送完成消息
              const finishData = {
                role: 'agent',
                type: 'answer',
                answer_stream: '',
                message_id: sessionId,
                agent_id: botId,
                is_finish: true
              };
              
              await writer.write(encoder.encode(`event: message\n`));
              await writer.write(encoder.encode(`data: ${JSON.stringify(finishData)}\n\n`));
              
              // 发送done事件
              const doneData = {
                role: 'agent',
                type: 'answer',
                message_id: sessionId,
                agent_id: botId,
                is_finish: true
              };
              
              await writer.write(encoder.encode(`event: done\n`));
              await writer.write(encoder.encode(`data: ${JSON.stringify(doneData)}\n\n`));
              
              console.log('[Worker] Stream ended');
              
              // 关闭连接
              ws.close();
              await writer.close();
              break;
              
            case 'stream_error':
              // 发送错误事件
              const errorData = {
                message: message.error || 'Unknown error'
              };
              
              await writer.write(encoder.encode(`event: error\n`));
              await writer.write(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`));
              
              console.error(`[Worker] Stream error: ${message.error}`);
              
              // 关闭连接
              ws.close();
              await writer.close();
              break;
              
            case 'pong':
              // 响应ping
              break;
              
            default:
              console.warn(`[Worker] Unknown message type: ${message.type}`);
          }
        }
        
      } catch (parseError) {
        console.error('[Worker] Error parsing message:', parseError);
      }
    });
    
    // 监听错误
    ws.addEventListener('error', async (error) => {
      console.error('[Worker] WebSocket error:', error);
      
      const errorData = {
        message: 'WebSocket connection error'
      };
      
      await writer.write(encoder.encode(`event: error\n`));
      await writer.write(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`));
      await writer.close();
    });
    
    // 监听关闭
    ws.addEventListener('close', async () => {
      console.log('[Worker] WebSocket closed');
      
      // 确保writer关闭
      try {
        await writer.close();
      } catch (e) {
        // Writer可能已经关闭
      }
    });
    
  } catch (error) {
    console.error('[Worker] Failed to establish WebSocket connection:', error);
    
    const errorData = {
      message: 'Failed to connect to backend'
    };
    
    await writer.write(encoder.encode(`event: error\n`));
    await writer.write(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`));
    await writer.close();
    
    if (ws) {
      ws.close();
    }
  }
}
