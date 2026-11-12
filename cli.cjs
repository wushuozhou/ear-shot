#!/usr/bin/env node
// Small terminal entry point for people who do not want to edit .env by hand.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { loadEnv, config } = require('./server/config');
const { createServer } = require('./server/index');

const ROOT = __dirname;
const ask = (question) => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
});

function printStatus() {
  loadEnv();
  const cfg = config();
  const env = fs.existsSync(path.join(ROOT, '.env'));
  const mask = value => value ? `${value.slice(0, 3)}***` : '未设置';
  console.log('\nEarshot 状态');
  console.log(`  配置文件: ${env ? '已存在' : '未设置（先运行配置）'}`);
  console.log(`  模型: ${cfg.llm.base} / ${cfg.llm.model}  ${mask(cfg.llm.key)}`);
  console.log(`  转写: ${cfg.stt.base} / ${cfg.stt.model}  ${mask(cfg.stt.key)}`);
  console.log(`  声音: ${cfg.tts.provider} / ${cfg.tts.provider === 'elevenlabs' ? cfg.tts.eleven.model : cfg.tts.openai.model}`);
  console.log(`  地址: http://localhost:${cfg.port}`);
}

function usage() {
  console.log(`
Earshot · 听着呢

用法:
  npm run earshot              打开终端菜单
  npm run earshot setup        配置模型、耳朵和声音
  npm run earshot check        检查三个服务的真实连接
  npm run earshot start        启动服务并打开网页
  npm run earshot status       查看当前配置
`);
}

async function setup() {
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'setup.cjs')], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code ? reject(new Error(`配置向导退出码 ${code}`)) : resolve());
  });
}

async function start() {
  loadEnv();
  const cfg = config();
  if (!fs.existsSync(path.join(ROOT, '.env'))) {
    console.log('还没有配置文件，先打开配置向导。\n');
    await setup();
    loadEnv();
  }
  const server = createServer(config());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config().port, () => {
      console.log(`\n✓ 已启动: http://localhost:${config().port}`);
      console.log('用浏览器打开上面的地址，允许麦克风后即可通话。按 Ctrl+C 停止。\n');
      resolve();
    });
  });
}

async function menu() {
  if (!process.stdin.isTTY) return usage();
  for (;;) {
    console.log('\nEarshot · 听着呢');
    console.log('  1. 首次配置 / 修改供应商');
    console.log('  2. 检查模型、转写、声音连接');
    console.log('  3. 启动通话服务');
    console.log('  4. 查看当前状态');
    console.log('  5. 退出');
    const choice = await ask('\n请选择 [1-5]: ');
    if (choice === '1') await setup();
    else if (choice === '2') spawn(process.execPath, [path.join(ROOT, 'tools', 'check.cjs')], { stdio: 'inherit', cwd: ROOT });
    else if (choice === '3') return start();
    else if (choice === '4') printStatus();
    else if (choice === '5' || !choice) return;
    else console.log('请输入 1 到 5。');
  }
}

(async () => {
  try {
    const command = process.argv[2] || 'menu';
    if (command === 'setup' || command === 'config') await setup();
    else if (command === 'check') spawn(process.execPath, [path.join(ROOT, 'tools', 'check.cjs')], { stdio: 'inherit', cwd: ROOT });
    else if (command === 'start') await start();
    else if (command === 'status') printStatus();
    else if (command === 'help' || command === '--help' || command === '-h') usage();
    else await menu();
  } catch (error) {
    console.error(`\n✗ ${error.message}`);
    process.exitCode = 1;
  }
})();
