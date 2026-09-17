if(process.env.REPLIQA_FREE_PLAN_CONFIRMED!=='true')throw Error('Confirm the account is Free before deploying this diagnostic');
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const files=['cloud/src/network-relay.mjs','cloud/src/target-guard.mjs','cloud/src/runner.mjs','cloud/src/actions.mjs','cloud/src/outcomes.mjs'];
const data=await Promise.all(files.map(p=>fs.readFile(new URL('../../'+p,import.meta.url))));
const hash=createHash('sha256');for(const bytes of data)hash.update(bytes);
await fs.writeFile(new URL('revision.mjs',import.meta.url),`export const sourceHash='${hash.digest('hex')}';\n`);
execFileSync(process.execPath,['cloud/node_modules/wrangler/bin/wrangler.js','deploy','--config','evaluation/network-relay/wrangler.jsonc'],{stdio:'inherit',windowsHide:true});
