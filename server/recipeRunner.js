import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import YAML from 'yaml';

const exec = promisify(execFile);

function expand(str, ctx) {
  return String(str ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => ctx.vars[k] ?? '');
}

function resolvePath(dataPath, p, ctx) {
  const raw = expand(p, ctx).replace(/^\$SERVER\//, '').replace(/^\//, '');
  if (path.isAbsolute(expand(p, ctx))) return expand(p, ctx);
  return path.join(dataPath, raw);
}

async function downloadFile(url, dest, onLog) {
  onLog(`download ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`Download ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function runTask(task, ctx) {
  const action = String(task.action || task.type || '').toLowerCase();
  const { dataPath, onLog } = ctx;

  if (action === 'set_variable' || action === 'setvar') {
    ctx.vars[task.name] = task.value ?? '';
    return;
  }

  if (action === 'download_file' || action === 'downloadfile') {
    const dest = resolvePath(dataPath, task.path || task.dest, ctx);
    await downloadFile(expand(task.url, ctx), dest, onLog);
    return;
  }

  if (action === 'download_github' || action === 'downloadgithub') {
    const ref = task.ref || task.branch || 'main';
    const url = `https://github.com/${task.src || `${task.org}/${task.repo}`}/archive/refs/heads/${ref}.zip`;
    const dest = resolvePath(dataPath, task.dest || task.path, ctx);
    const zip = dest.endsWith('.zip') ? dest : `${dest}.zip`;
    await downloadFile(url, zip, onLog);
    fs.mkdirSync(dest, { recursive: true });
    await exec('unzip', ['-o', zip, '-d', dest], { timeout: 300_000 });
    fs.unlinkSync(zip);
    return;
  }

  if (action === 'unzip') {
    const file = resolvePath(dataPath, task.file || task.src, ctx);
    const dest = resolvePath(dataPath, task.dest || task.path, ctx);
    fs.mkdirSync(dest, { recursive: true });
    await exec('unzip', ['-o', file, '-d', dest], { timeout: 300_000 });
    return;
  }

  if (action === 'ensure_dir' || action === 'ensuredir') {
    fs.mkdirSync(resolvePath(dataPath, task.path, ctx), { recursive: true });
    return;
  }

  if (action === 'write_file' || action === 'writefile') {
    const file = resolvePath(dataPath, task.file || task.path, ctx);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, expand(task.data ?? task.content ?? '', ctx), 'utf8');
    return;
  }

  if (action === 'append_file' || action === 'appendfile') {
    const file = resolvePath(dataPath, task.file || task.path, ctx);
    const line = expand(task.data ?? task.content ?? '', ctx);
    let cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!cur.includes(line.trim())) cur = `${cur.trim()}\n${line}\n`;
    fs.writeFileSync(file, cur, 'utf8');
    return;
  }

  if (action === 'remove_path' || action === 'removepath') {
    const p = resolvePath(dataPath, task.path, ctx);
    fs.rmSync(p, { recursive: true, force: true });
    return;
  }

  if (action === 'copy_path' || action === 'copypath') {
    const src = resolvePath(dataPath, task.src, ctx);
    const dest = resolvePath(dataPath, task.dest, ctx);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    return;
  }

  if (action === 'ensure' || action === 'ensure_resource') {
    const res = task.resource || task.name;
    const cfg = path.join(dataPath, 'server.cfg');
    let cur = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
    const line = `ensure ${res}`;
    if (!cur.includes(line)) {
      cur = `${cur.trim()}\n${line}\n`;
      fs.writeFileSync(cfg, cur, 'utf8');
    }
    return;
  }

  if (action === 'replace_string' || action === 'replacestring') {
    const file = resolvePath(dataPath, task.file || task.path, ctx);
    let cur = fs.readFileSync(file, 'utf8');
    const from = expand(task.old || task.search, ctx);
    const to = expand(task.new || task.replace, ctx);
    if (!cur.includes(from)) onLog(`replace_string: Treffer nicht gefunden in ${file}`);
    else {
      cur = cur.split(from).join(to);
      fs.writeFileSync(file, cur, 'utf8');
    }
    return;
  }

  if (action === 'connect_database' || action === 'connectdatabase') {
    const cfg = path.join(dataPath, 'server.cfg');
    const conn = expand(task.connectionString || task.value || task.mysql, ctx);
    let cur = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
    const line = `set mysql_connection_string "${conn.replace(/"/g, '')}"`;
    if (!cur.includes('mysql_connection_string')) cur = `${cur.trim()}\n${line}\n`;
    else cur = cur.replace(/set\s+mysql_connection_string\s+.*/i, line);
    fs.writeFileSync(cfg, cur, 'utf8');
    ctx.vars.MYSQL = conn;
    return;
  }

  if (action === 'move_path' || action === 'movepath') {
    const src = resolvePath(dataPath, task.src || task.from, ctx);
    const dest = resolvePath(dataPath, task.dest || task.to, ctx);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return;
  }

  if (action === 'waste_time' || action === 'wait') {
    const ms = Math.min(Number(task.seconds || task.ms || 1) * (task.ms ? 1 : 1000), 30_000);
    await new Promise((r) => setTimeout(r, ms));
    return;
  }

  throw new Error(`Unbekannte Recipe-Action: ${action}`);
}

/**
 * @param {string} yamlText
 * @param {string} dataPath
 * @param {(msg: string) => void} onLog
 */
export async function runRecipeYaml(yamlText, dataPath, onLog = () => {}) {
  const doc = YAML.parse(yamlText);
  if (!doc || typeof doc !== 'object') throw new Error('Recipe YAML ungültig.');
  const ctx = {
    dataPath,
    onLog,
    vars: {
      SERVER: dataPath,
      ...(doc.variables || {}),
    },
  };
  const tasks = doc.tasks || doc.steps || [];
  if (!Array.isArray(tasks)) throw new Error('tasks[] fehlt im Recipe.');
  const results = [];
  for (const task of tasks) {
    onLog(`→ ${task.action || task.type}`);
    await runTask(task, ctx);
    results.push({ action: task.action || task.type, ok: true });
  }
  return { name: doc.name || 'recipe', tasksRun: results.length, vars: ctx.vars };
}
