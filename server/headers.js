// 这些环境变量由 desktop 的 Provider 层注入，用于第三方供应商的自定义请求头。
function extraHeaders(name, required = {}) {
  let parsed = {};
  try {
    const raw = process.env[name];
    const value = raw ? JSON.parse(raw) : {};
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value;
  } catch (_) {
    parsed = {};
  }
  const custom = Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
  );
  return { ...custom, ...required };
}

module.exports = { extraHeaders };
