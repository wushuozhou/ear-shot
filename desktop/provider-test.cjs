function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : 8000);
}

function headersFor(provider) {
  const headers = { ...(provider.extraHeaders || {}) };
  if (provider.apiKey) {
    if (provider.protocol === 'elevenlabs') headers['xi-api-key'] = provider.apiKey;
    else headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

function endpoint(provider, suffix) {
  return `${String(provider.baseUrl || '').replace(/\/+$/, '')}${suffix}`;
}

function errorMessage(error, provider) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return '连接超时，请检查地址或增大超时时间';
  if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') return '网络或 DNS 不通，找不到服务器';
  if (error?.code === 'ECONNREFUSED') return '网络不通，目标服务拒绝了连接';
  if (error?.code === 'ECONNRESET') return '网络连接被远端关闭';
  if (error?.message && !/fetch failed/i.test(error.message)) return `网络连接失败：${error.message}`;
  return `无法连接到 ${provider.name || '供应商'}`;
}

function statusMessage(status) {
  if (status === 401 || status === 403) return '鉴权失败，请检查 API Key 和权限';
  if (status === 404) return '地址或模型不存在，请检查 Base URL 和模型名称';
  if (status === 429) return '供应商限流或账户额度不足';
  if (status >= 500) return `供应商服务器错误（${status}）`;
  return `供应商返回错误（${status}）`;
}

async function request(provider, url, options, fetcher) {
  const started = Date.now();
  try {
    const response = await fetcher(url, { ...options, signal: timeoutSignal(provider.timeoutMs) });
    return { response, latencyMs: Date.now() - started };
  } catch (error) {
    return { error, latencyMs: Date.now() - started };
  }
}

async function testProvider(provider, { fetcher = fetch } = {}) {
  const started = Date.now();
  if (!provider || !provider.baseUrl) return { ok: false, status: 0, latencyMs: 0, message: '请填写 Base URL' };
  const headers = headersFor(provider);
  let result;
  if (provider.kind === 'llm') {
    result = await request(provider, endpoint(provider, '/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1, stream: false }),
    }, fetcher);
  } else if (provider.kind === 'stt') {
    result = await request(provider, endpoint(provider, '/models'), { method: 'GET', headers }, fetcher);
  } else if (provider.protocol === 'elevenlabs') {
    result = await request(provider, endpoint(provider, `/v1/text-to-speech/${encodeURIComponent(provider.voice || '')}/stream?output_format=mp3_44100_64`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg', ...headers },
      body: JSON.stringify({ text: '好。', model_id: provider.model }),
    }, fetcher);
  } else {
    result = await request(provider, endpoint(provider, '/audio/speech'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ model: provider.model, voice: provider.voice || 'alloy', input: '好。', response_format: 'mp3' }),
    }, fetcher);
  }
  const latencyMs = result.latencyMs ?? Date.now() - started;
  if (result.error) return { ok: false, status: 0, latencyMs, message: errorMessage(result.error, provider) };
  if (!result.response.ok) return { ok: false, status: result.response.status, latencyMs, message: statusMessage(result.response.status) };
  return { ok: true, status: result.response.status, latencyMs, message: '连接成功' };
}

module.exports = { testProvider };
