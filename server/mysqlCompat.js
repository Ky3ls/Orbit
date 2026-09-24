import fs from 'node:fs';
import path from 'node:path';

/**
 * MySQL 8 kennt kein "ADD COLUMN IF NOT EXISTS" (MariaDB-Syntax).
 * Patcht ESX-Ressourcen nach dem Clone und stellt Spalten kompatibel sicher.
 */

function walkFiles(root, exts, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (/^(localization|locale|node_modules|\.git)$/i.test(ent.name)) continue;
      walkFiles(p, exts, out);
    } else if (exts.some((e) => ent.name.toLowerCase().endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

/** Ersetzt problematische ALTER TABLE IF NOT EXISTS in .lua durch information_schema-Check. */
export function patchMysql8CompatInResources(resourcesRoot, onLog = () => {}) {
  if (!resourcesRoot || !fs.existsSync(resourcesRoot)) return { patched: 0 };
  let patched = 0;
  for (const file of walkFiles(resourcesRoot, ['.lua'])) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!/ADD COLUMN IF NOT EXISTS/i.test(raw)) continue;

    // Typischer esx_property One-Liner (MySQL 8 hat kein ADD COLUMN IF NOT EXISTS)
    const next = raw.replace(
      /MySQL\.query\(\s*"ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `last_property` LONGTEXT NULL"\s*,\s*function\(result\)\s*([\s\S]*?)\s*end\)/m,
      `do
\tlocal col = MySQL.scalar.await([[SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_property']])
\tif not col or tonumber(col) == 0 then
\t\tMySQL.query("ALTER TABLE \`users\` ADD COLUMN \`last_property\` LONGTEXT NULL", function(result)
$1\tend)
\tend
end`,
    );

    let out = next;
    // Generisch: "ADD COLUMN IF NOT EXISTS" in SQL-Strings → ohne IF NOT EXISTS
    // (Spalte legen wir parallel per ensureMysqlColumns an)
    if (out === raw) {
      out = raw.replace(/ADD COLUMN IF NOT EXISTS/gi, 'ADD COLUMN');
    }

    if (out !== raw) {
      fs.writeFileSync(file, out, 'utf8');
      patched += 1;
      onLog(`MySQL8-Patch: ${path.relative(resourcesRoot, file)}`);
    }
  }

  // .sql Dateien: IF NOT EXISTS bei ADD COLUMN entfernen (Import + ensureColumns)
  for (const file of walkFiles(resourcesRoot, ['.sql'])) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!/ADD COLUMN IF NOT EXISTS/i.test(raw)) continue;
    const out = raw.replace(/ADD COLUMN IF NOT EXISTS/gi, 'ADD COLUMN');
    if (out !== raw) {
      fs.writeFileSync(file, out, 'utf8');
      patched += 1;
      onLog(`MySQL8-Patch SQL: ${path.relative(resourcesRoot, file)}`);
    }
  }

  return { patched };
}

/**
 * Stellt Spalten sicher, die ESX-Addons erwarten (MySQL-8-kompatibel).
 * @param {import('mysql2/promise').Connection} conn
 */
export async function ensureEsxAddonColumns(conn, onLog = () => {}) {
  const cols = [
    { table: 'users', name: 'last_property', ddl: 'LONGTEXT NULL' },
    { table: 'users', name: 'pincode', ddl: 'INT NULL' },
  ];
  for (const c of cols) {
    try {
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [c.table, c.name],
      );
      const n = Number(rows?.[0]?.n || 0);
      if (n > 0) continue;
      await conn.query(`ALTER TABLE \`${c.table}\` ADD COLUMN \`${c.name}\` ${c.ddl}`);
      onLog(`Spalte ${c.table}.${c.name} angelegt.`);
    } catch (err) {
      onLog(`Spalte ${c.table}.${c.name}: ${String(err.message || err).slice(0, 120)}`);
    }
  }
}
