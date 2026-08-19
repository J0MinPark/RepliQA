// shopping_admin_final_0719.tar / postmill-populated-exposed-withimg.tar 다운로드가 끝난
// 뒤, docker load → docker run → Magento base URL 재설정까지 한 번에 처리한다
// (environment_docker/README.md의 수동 명령어를 그대로 스크립트화한 것 — README.md에
// 각 명령어의 의미를 적어뒀다).
//
// 사용법(백엔드 디렉터리에서, WebArena .tar 파일들이 있는 디렉터리를 인자로):
//   node scripts/webarena-bench/setupDocker.js <tar 파일들이 있는 디렉터리>

const { execFileSync } = require('child_process');
const path = require('path');

const tarDir = process.argv[2];
if (!tarDir) {
  console.error('사용법: node setupDocker.js <tar 파일들이 있는 디렉터리>');
  process.exit(1);
}

const SHOPPING_ADMIN_TAR = 'shopping_admin_final_0719.tar';
const FORUM_TAR = 'postmill-populated-exposed-withimg.tar';
const SHOPPING_ADMIN_IMAGE = 'shopping_admin_final_0719';
const FORUM_IMAGE = 'postmill-populated-exposed-withimg';
const SHOPPING_ADMIN_BASE_URL = process.env.SHOPPING_ADMIN_BASE_URL || 'http://localhost:7780';

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function containerExists(name) {
  try {
    const out = execFileSync('docker', ['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}']).toString().trim();
    return out === name;
  } catch {
    return false;
  }
}

function main() {
  console.log('=== 1. docker load ===');
  run('docker', ['load', '--input', path.join(tarDir, SHOPPING_ADMIN_TAR)]);
  run('docker', ['load', '--input', path.join(tarDir, FORUM_TAR)]);

  console.log('\n=== 2. docker run ===');
  if (containerExists('shopping_admin')) {
    console.log('shopping_admin 컨테이너가 이미 있어 재사용합니다(재생성하려면 먼저 docker rm -f shopping_admin).');
  } else {
    run('docker', ['run', '--name', 'shopping_admin', '-p', '7780:80', '-d', SHOPPING_ADMIN_IMAGE]);
  }
  if (containerExists('forum')) {
    console.log('forum 컨테이너가 이미 있어 재사용합니다(재생성하려면 먼저 docker rm -f forum).');
  } else {
    run('docker', ['run', '--name', 'forum', '-p', '9999:80', '-d', FORUM_IMAGE]);
  }

  console.log('\n=== 3. Magento base URL 재설정(빌드 시점 URL이 DB에 박혀 있어 재설정 필요) ===');
  run('docker', [
    'exec', 'shopping_admin', '/var/www/magento2/bin/magento', 'setup:store-config:set',
    `--base-url=${SHOPPING_ADMIN_BASE_URL}`,
  ]);
  run('docker', [
    'exec', 'shopping_admin', 'mysql', '-u', 'magentouser', '-pMyPassword', 'magentodb', '-e',
    `UPDATE core_config_data SET value="${SHOPPING_ADMIN_BASE_URL}/" WHERE path = "web/secure/base_url";`,
  ]);
  run('docker', ['exec', 'shopping_admin', '/var/www/magento2/bin/magento', 'cache:flush']);

  console.log(`\n완료. shopping_admin: ${SHOPPING_ADMIN_BASE_URL}/admin , forum: http://localhost:9999/`);
  console.log('다음 단계: npm run webarena:login');
}

main();
