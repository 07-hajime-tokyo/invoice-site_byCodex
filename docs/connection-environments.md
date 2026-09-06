# Connection environments

Vercel production keeps its existing default sheet IDs and site URL. Preview never inherits those defaults, even when NODE_ENV is production. APP_ENV can be production, staging, development or test; a conflicting VERCEL_ENV fails. A non-Vercel production server must explicitly set APP_ENV=production. NODE_ENV alone does not authorize production resources.

For staging configure:

| Variable | Meaning |
|---|---|
| APP_ENV | staging (optional on Vercel Preview, required for an explicit local staging run) |
| DATABASE_URL | Dedicated database credentials, delivered through secrets management |
| NON_PRODUCTION_DATABASE_TARGET | Credential-free mysql://host:port/database; must match DATABASE_URL exactly by host, port and database |
| TRADE_SOURCE_SPREADSHEET_ID | Independent source/edit sheet |
| TRADE_SHIPMENT_SPREADSHEET_ID | Independent shipment sheet, shared by the two API groups |
| YAHOO_LISTING_SPREADSHEET_ID | Independent listing sheet |
| GOOGLE_SERVICE_ACCOUNT_JSON | Dedicated account with access only to test files; when set, all three sheet IDs are required |
| GAS_WEBHOOK_URL / NON_PRODUCTION_GAS_URL | Same explicitly approved test endpoint; leave both unset to disable |
| RECEIPT_ACK_DRIVE_FOLDER_ID / NON_PRODUCTION_RECEIPT_ACK_FOLDER_ID | Same explicitly approved test folder; leave both unset if unused |
| PUBLIC_SITE_URL | Explicit test origin, required when generating listing-photo URLs |
| RUN_RUNTIME_SCHEMA_CHECK / RUN_INVENTORY_ONE_TIME_REPAIRS | Set both to 0; provision the test schema separately |

All known production sheet IDs are rejected in non-production, including when supplied under another sheet setting. The historical production photo origin is rejected. SQL dump fallback is disabled outside production. Runtime pool creation and Drizzle configuration both check the DB target before connecting; DB helpers do not swallow target errors.

These are configuration guards, not a replacement for resource permissions. The application cannot prove a user-supplied DB target, GAS endpoint, Drive folder or a new site alias belongs to staging. Do not copy production credentials or approval targets into staging. Use a DB user limited to a separate database and a Google account limited to test resources. Cron, GAS webhook and receipt-ack ingestion HTTP entrypoints now reject all non-production requests before their handlers. This does not block calls through other interfaces or all outbound traffic. DB identity-marker verification, dedicated resources and complete AI/storage isolation are still outstanding. Audit standalone import scripts before using them; they are not covered by the runtime/Drizzle guards.

The public site URL is resolved on use so tests and builds can import modules without needing a deployed origin. A running application validates configured connections during API initialization; missing database configuration still allows the existing DB-free paths. A deployed staging instance must be provisioned and verified before being used for acceptance testing.

Run `pnpm test` for unit tests. Their setup clears live connection settings and blocks global fetch; individual tests inject mock transports. This does not sandbox arbitrary Node HTTP libraries. `pnpm test:integration` is a separate, real-network Gemini check requiring GEMINI_API_KEY and an explicitly selected GEMINI_TEST_MODEL. It is not part of the unit suite and missing configuration fails. Never interpret unit results as evidence that live integrations work.

No deployment or resource creation is performed by this change. Use GitHub branch review before any production merge.
