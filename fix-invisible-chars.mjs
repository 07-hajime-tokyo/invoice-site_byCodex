import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// 不可視文字を除去する関数
function sanitize(str) {
  if (str == null) return str;
  // ゼロ幅スペース、WORD JOINER、その他の不可視文字を除去
  return str.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').trim();
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// 全インボイスのclientSnapshotを取得して修正
const [rows] = await conn.query('SELECT id, invoiceNumber, clientSnapshot FROM invoices WHERE clientSnapshot IS NOT NULL');
let updated = 0;
for (const row of rows) {
  try {
    // mysql2はJSONカラムを自動パースする場合があるため両方対応
    const snap = typeof row.clientSnapshot === 'string' ? JSON.parse(row.clientSnapshot) : row.clientSnapshot;
    let changed = false;
    for (const key of Object.keys(snap)) {
      if (typeof snap[key] === 'string') {
        const cleaned = sanitize(snap[key]);
        if (cleaned !== snap[key]) {
          console.log('Fixing', row.invoiceNumber, key, JSON.stringify(snap[key]), '->', JSON.stringify(cleaned));
          snap[key] = cleaned;
          changed = true;
        }
      }
    }
    if (changed) {
      await conn.query('UPDATE invoices SET clientSnapshot = ? WHERE id = ?', [JSON.stringify(snap), row.id]);
      updated++;
    }
  } catch(e) {
    console.error('Error processing invoice', row.invoiceNumber, e.message);
  }
}
console.log('Updated', updated, 'invoices');
await conn.end();
