import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Generates a private SQL file only. No remote mutation or invitation is sent.
const args = process.argv.slice(2); const origins = args.filter((arg) => arg.startsWith('https://')).map((value) => new URL(value).origin);
if (!origins.length) throw new Error('사용법: npm run invite -- https://staging.example.com [--host=cdn.example.com]');
const hosts = args.filter((arg) => arg.startsWith('--host=')).map((arg) => arg.slice(7));
if (hosts.some((host) => !/^[a-zA-Z0-9.-]+$/.test(host))) throw new Error('CDN 호스트 이름을 확인하세요.');
const token = crypto.randomBytes(32).toString('base64url'); const id = crypto.randomUUID();
const digest = crypto.createHash('sha256').update(token).digest('hex');
const quote = (text) => `'${text.replaceAll("'", "''")}'`;
const sql = `INSERT INTO tenants (id,token_hash,origins,resource_hosts,expires_at) VALUES (${quote(id)},${quote(digest)},${quote(JSON.stringify(origins))},${quote(JSON.stringify(hosts))},${Date.now() + 30 * 86400000});\n`;
const root = fileURLToPath(new URL('../', import.meta.url));
await fs.writeFile(path.join(root, `${id}.private.sql`), sql, { mode: 0o600, flag: 'wx' });
// A locally opened file avoids logging a live token in build/deploy output.
const tokenFile = path.join(root, `${id}.invite.private`);
await fs.writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
console.log(`SQL: ${id}.private.sql\n초대 키 파일: ${id}.invite.private\n키는 채팅·로그·저장소에 붙여넣지 마세요. 계정별 30일 후 만료됩니다.`);
