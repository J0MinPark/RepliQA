import fs from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const config = JSON.parse(await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if(!process.env.REPLIQA_PUBLIC_ORIGIN||new URL(process.env.REPLIQA_PUBLIC_ORIGIN).protocol!=='https:')throw new Error('Set REPLIQA_PUBLIC_ORIGIN before deployment.');
if (config.vars.FREE_PLAN_CONFIRMED !== 'true' || /^0+-0+-0+-0+-0+$/.test(config.d1_databases[0].database_id)) {
  throw new Error('먼저 Cloudflare Workers Free 계정과 D1 데이터베이스를 설정하세요. cloud/README.md를 참고하세요. 유료 계정 배포는 이 무료 파일럿에서 지원하지 않습니다.');
}
const root = new URL('../', import.meta.url);
const cli = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
// A previous green report cannot authorize shipping a different browser engine.
// This is a regression gate for a declared corpus, not a general accuracy certificate.
const evidence = process.env.REPLIQA_EVALUATION_RECEIPT || fileURLToPath(new URL('../../docs/evidence/qa-skills/verified.json', import.meta.url));
execFileSync(process.execPath,['--test',fileURLToPath(new URL('../test/bundled-accessibility.test.mjs',import.meta.url))],{windowsHide:true,stdio:'inherit'});
execFileSync(process.execPath, [fileURLToPath(new URL('../../evaluation/gate.mjs', import.meta.url)), evidence], { windowsHide: true, stdio: 'inherit' });
const child = spawn(process.execPath, [fileURLToPath(cli), 'deploy'], { cwd: root, windowsHide: true, stdio: 'inherit' });
child.on('error', () => { console.error('Could not start Wrangler.');process.exitCode=1; });
child.on('exit', (code) => {
  if(code!==0){process.exitCode=code||1;return;}
  const check=spawn(process.execPath,[fileURLToPath(new URL('./check-deployment.mjs',import.meta.url))],{cwd:root,windowsHide:true,stdio:'inherit'});
  check.on('error',()=>{console.error('Could not verify the public deployment.');process.exitCode=1;});
  check.on('exit',status=>{process.exitCode=status===0?0:status||1;});
});
