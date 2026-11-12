const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  version: 1,
  port: 8787,
  env: {},
  dataDir: '',
  installDirHint: '',
};

function configPath(app) {
  return path.join(app.getPath('userData'), 'config.json');
}

function mergeConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...DEFAULT_CONFIG,
    ...source,
    env: {
      ...DEFAULT_CONFIG.env,
      ...(source.env && typeof source.env === 'object' ? source.env : {}),
    },
  };
}

function writeConfig(app, value) {
  const file = configPath(app);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(mergeConfig(value), null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loadConfig(app) {
  const file = configPath(app);
  if (!fs.existsSync(file)) {
    const config = mergeConfig({});
    writeConfig(app, config);
    return config;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`配置文件无法读取：${error.message}`);
  }
  const config = mergeConfig(parsed);
  if (JSON.stringify(config) !== JSON.stringify(parsed)) writeConfig(app, config);
  return config;
}

function readDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function launchEnvironment(app, config, rootDir, port) {
  const dotenv = readDotEnv(path.join(rootDir, '.env'));
  return {
    ...process.env,
    ...dotenv,
    ...(config.env || {}),
    PORT: String(port),
  };
}

module.exports = {
  DEFAULT_CONFIG,
  configPath,
  loadConfig,
  writeConfig,
  launchEnvironment,
};
