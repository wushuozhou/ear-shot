#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const desktopPackagePath = path.join(rootDir, 'desktop', 'package.json');
const version = process.argv[2];

function fail(message) {
  console.error(`发版失败：${message}`);
  process.exitCode = 1;
}

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '')) {
  fail('版本号必须是 x.y.z 格式，例如 0.1.3');
} else {
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (status.error) {
    fail(`无法检查 Git 状态：${status.error.message}`);
  } else if (status.status !== 0) {
    fail(`Git 状态检查失败：${status.stderr.trim() || `退出码 ${status.status}`}`);
  } else if (status.stdout.trim()) {
    fail('工作区不干净，请先提交或处理现有改动');
  } else {
    try {
      const packageJson = JSON.parse(fs.readFileSync(desktopPackagePath, 'utf8'));
      packageJson.version = version;
      fs.writeFileSync(desktopPackagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
      console.log(`已将 desktop/package.json 版本更新为 ${version}`);
      console.log('请手动执行以下两条 Git 命令：');
      console.log(`git add -A && git commit -m "build: 发布 v${version}"`);
      console.log(`git tag -a v${version} -m "v${version}" && git push origin main && git push origin v${version}`);
    } catch (error) {
      fail(`无法更新 desktop/package.json：${error.message}`);
    }
  }
}
