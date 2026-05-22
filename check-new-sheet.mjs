import { google } from 'googleapis';
import { readFileSync } from 'fs';

const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  console.error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  process.exit(1);
}

const fixedJson = serviceAccountJson
  .replace(/-----BEGINPRIVATEKEY-----/g, '-----BEGIN PRIVATE KEY-----')
  .replace(/-----ENDPRIVATEKEY-----/g, '-----END PRIVATE KEY-----')
  .replace(/-----BEGINCERTIFICATE-----/g, '-----BEGIN CERTIFICATE-----')
  .replace(/-----ENDCERTIFICATE-----/g, '-----END CERTIFICATE-----');

let credentials;
try {
  credentials = JSON.parse(fixedJson);
} catch (e) {
  console.error('JSON parse error:', e.message);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = '1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw';

// まずシート一覧を確認
const meta = await sheets.spreadsheets.get({ spreadsheetId });
console.log('シート一覧:');
meta.data.sheets?.forEach(s => console.log(' -', s.properties?.title));

// 最初のシートの先頭5行を確認
const firstSheetName = meta.data.sheets?.[0]?.properties?.title;
if (firstSheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${firstSheetName}!A1:T5`,
  });
  console.log(`\n${firstSheetName}の先頭5行:`);
  (res.data.values || []).forEach((row, i) => {
    console.log(`行${i+1}: ${JSON.stringify(row)}`);
  });
}
