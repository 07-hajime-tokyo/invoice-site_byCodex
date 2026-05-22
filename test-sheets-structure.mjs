import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const SPREADSHEET_ID = '1AVxdNbYmgD-rAFYagD7m9XRTvz10KrBWzEiOC4jeflk';
const SHEET_NAME = '全体';

function fixServiceAccountJson(jsonStr) {
  const credentials = JSON.parse(jsonStr);
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key
      .replace(/-----BEGINPRIVATEKEY-----/g, '-----BEGIN PRIVATE KEY-----')
      .replace(/-----ENDPRIVATEKEY-----/g, '-----END PRIVATE KEY-----')
      .replace(/-----BEGINRSAPRIVATEKEY-----/g, '-----BEGIN RSA PRIVATE KEY-----')
      .replace(/-----ENDRSAPRIVATEKEY-----/g, '-----END RSA PRIVATE KEY-----')
      .replace(/\\n/g, '\n');
  }
  return credentials;
}

async function checkStructure() {
  const credentials = fixServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Get first 10 rows with wider range
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:AZ10`,
  });

  const rows = response.data.values || [];
  console.log(`Total rows fetched: ${rows.length}`);
  rows.forEach((row, i) => {
    console.log(`Row ${i + 1} (${row.length} cols):`, row);
  });
}

checkStructure().catch(console.error);
