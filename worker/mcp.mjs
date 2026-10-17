/**
 * Stateless Sites MCP adapter. Sites supplies the authenticated identity header.
 * Inject the existing radarResponse handler so this module cannot become a proxy
 * and does not introduce an index -> mcp -> index import cycle.
 */
const MCP_MAX_BYTES = 8192;
const MCP_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const MCP_TOOLS = [
  {
    name: 'read_radar',
    title: '读取公开资讯雷达',
    description: '读取 Dayline 固定公开来源的共享资讯缓存、更新时间和来源状态；不读取个人日程、预算或收藏。遵守现有自动缓存更新规则。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'refresh_radar',
    title: '更新公开资讯雷达',
    description: '以已认证的 Sites 身份等待固定公开来源的雷达更新结果；遵守现有一小时冷却，不接受自定义来源或强制刷新参数。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_demand',
    title: '读取公开需求线索',
    description: '读取固定公开社区API中的需求线索、付款证据等级、变化和来源状态；公开问题不等于客户或订单，不读取个人计划。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'refresh_demand',
    title: '更新公开需求线索',
    description: '以已认证的Sites身份检索固定公开社区API并等待保存结果；尊重一小时冷却，不接受任意网址、关键词或联系方式，不联系客户。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
function mcpJSON(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...MCP_HEADERS, ...extraHeaders } });
}
function mcpError(id, code, message, status = 200, extraHeaders) {
  return mcpJSON({ jsonrpc: '2.0', id, error: { code, message } }, status, extraHeaders);
}
function mcpResult(id, result, status = 200) {
  return mcpJSON({ jsonrpc: '2.0', id, result }, status);
}
function mcpToolText(data, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], isError };
}
function mcpObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function mcpValidId(value) { return value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value); }

async function mcpReadBody(request) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > MCP_MAX_BYTES) throw Object.assign(new Error('请求体超过8KB'), { status: 413 });
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MCP_MAX_BYTES) throw Object.assign(new Error('请求体超过8KB'), { status: 413 });
      chunks.push(value);
    }
  } finally {
    if (bytes > MCP_MAX_BYTES) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

/** Route only POST /mcp here; pass radarResponse as the fourth argument. */
export async function mcpResponse(request, env, ctx, radarHandler, demandHandler) {
  if (request.method !== 'POST') return mcpError(null, -32600, 'MCP只接受POST请求', 405, { Allow: 'POST' });
  let message;
  try { message = JSON.parse(await mcpReadBody(request)); }
  catch (error) {
    return error?.status === 413
      ? mcpError(null, -32600, '请求体超过8KB', 413)
      : mcpError(null, -32700, '请求体必须是有效JSON', 400);
  }
  const hasId = mcpObject(message) && Object.hasOwn(message, 'id');
  const id = hasId && mcpValidId(message.id) ? message.id : null;
  if (!mcpObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method || hasId && !mcpValidId(message.id)) {
    return mcpError(null, -32600, '无效JSON-RPC请求', 400);
  }
  // Notifications have no result channel: acknowledge without triggering tools.
  if (!hasId) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  if (message.method === 'server/discover') {
    return mcpResult(id, { supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, serverInfo: { name: 'Dayline Research', version: '1.1' } });
  }
  if (message.method === 'tools/list') return mcpResult(id, { tools: MCP_TOOLS });
  if (message.method !== 'tools/call') return mcpError(id, -32601, '不支持此MCP方法');

  const params = message.params;
  if (!mcpObject(params) || Object.keys(params).some(key => key !== 'name' && key !== 'arguments' && key !== '_meta')) return mcpError(id, -32602, '工具调用只接受name、空arguments和标准_meta');
  // Standard transport metadata is optional and ignored; it grants no authority.
  if (params._meta !== undefined && (!mcpObject(params._meta) || ![Object.prototype, null].includes(Object.getPrototypeOf(params._meta)))) return mcpError(id, -32602, '_meta必须是普通对象');
  if (!MCP_TOOLS.some(tool => tool.name === params.name)) return mcpError(id, -32602, '未知工具');
  if (params.arguments !== undefined && (!mcpObject(params.arguments) || Object.keys(params.arguments).length !== 0)) return mcpError(id, -32602, '雷达工具不接受任何参数');

  const refresh = params.name.startsWith('refresh_');
  const demand = params.name.endsWith('_demand');
  const handler = demand ? demandHandler : radarHandler;
  // This header is trusted only at the Sites-authenticated deployment boundary.
  if (refresh && !request.headers.get('oai-authenticated-user-id')?.trim()) {
    return mcpResult(id, mcpToolText({ error: '刷新需要已认证的Sites身份' }, true), 403);
  }
  if (typeof handler !== 'function') return mcpResult(id, mcpToolText({ error: '公开检索处理器未配置' }, true));
  try {
    const internalURL = new URL(`/api/${demand ? 'demand' : 'radar'}${refresh ? '?wait=1' : ''}`, request.url);
    // An in-process handler call, never a fetch to a client-selected origin/URL.
    const response = await handler(new Request(internalURL, { method: 'GET' }), env, ctx);
    const data = await response.json();
    const failed = !response.ok || data?.status === 'unavailable' || refresh && data?.meta?.successfulSources === 0;
    return mcpResult(id, mcpToolText(data, failed));
  } catch {
    return mcpResult(id, mcpToolText({ error: '公开雷达暂不可用，请稍后重试' }, true));
  }
}
