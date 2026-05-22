import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const SPREADSHEET_ID = '1AVxdNbYmgD-rAFYagD7m9XRTvz10KrBWzEiOC4jeflk';
const SHEET_NAME = '全体';

function fixServiceAccountJson(jsonStr) {
  const credentials = JSON.parse(jsonStr);
  // Fix private_key: restore spaces in header/footer that may have been stripped
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

async function testConnection() {
  try {
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
    }

    const credentials = fixServiceAccountJson(serviceAccountJson);
    console.log('✅ JSON parsed successfully');
    console.log('type:', credentials.type);
    console.log('client_email:', credentials.client_email);
    console.log('private_key starts with:', credentials.private_key?.substring(0, 50));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:Z3`,
    });

    const rows = response.data.values;
    console.log('✅ Connection successful!');
    console.log('Header row:', rows?.[0]);
    console.log('Row 2 (sample):', rows?.[1]);
    console.log('Total columns:', rows?.[0]?.length);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.error('Stack:', err.stack?.substring(0, 500));
  }
}

testConnection();
