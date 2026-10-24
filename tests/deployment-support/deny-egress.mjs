import { appendFileSync } from 'node:fs';
globalThis.fetch = async () => { appendFileSync(process.env.QA_EGRESS_LOG, 'BLOCKED_SERVER_FETCH\n'); throw new Error('QA outbound fetch forbidden'); };
