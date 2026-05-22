import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// 不可視文字を除去する関数
function sanitize(str) {
  if (str == null) return str;
  return str.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').trim() || null;
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// invoiceClientsテーブルの全データを取得
const [rows] = await conn.query('SELECT * FROM invoice_clients');
console.log('Total clients:', rows.length);

let updated = 0;
for (const row of rows) {
  const fields = ['name', 'company', 'email', 'phone', 'address', 'city', 'country', 'notes', 'extraInfo'];
  const updates = {};
  let changed = false;

  for (const field of fields) {
    if (typeof row[field] === 'string') {
      const cleaned = sanitize(row[field]);
      if (cleaned !== row[field]) {
        console.log(`Fixing client id=${row.id} field=${field}:`, JSON.stringify(row[field]), '->', JSON.stringify(cleaned));
        updates[field] = cleaned;
        changed = true;
      }
    }
  }

  if (changed) {
    const setClause = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
    const values = [...Object.values(updates), row.id];
    await conn.query(`UPDATE invoice_clients SET ${setClause} WHERE id = ?`, values);
    updated++;
  }
}

console.log('Updated', updated, 'clients');
await conn.end();
