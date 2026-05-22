import { google } from 'googleapis';

const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  console.error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  process.exit(1);
}

// スペース除去の修正
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
const spreadsheetId = '1AVxdNbYmgD-rAFYagD7m9XRTvz10KrBWzEiOC4jeflk';

const res = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: '全体!A295:T305',
});

const rows = res.data.values || [];
console.log('最終行付近のデータ:');
rows.forEach((row, i) => {
  console.log(`行 ${295 + i}: ${JSON.stringify(row.slice(0, 10))}`);
});
