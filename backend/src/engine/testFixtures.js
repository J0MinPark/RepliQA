const fs = require('fs');
const path = require('path');
const os = require('os');

const FIXTURE_DIR = path.join(os.tmpdir(), 'repliqa-fixtures');

// 실제로 존재하는 최소 유효 PNG(1x1 투명 픽셀) — 외부 파일/네트워크 의존 없이 그 자리에서
// 만들어낸다. 파일 업로드 액션의 fixtureType과 1:1 대응하고, 한 번 만들면 재사용한다.
const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function ensureFixture(filename, makeBuffer) {
  if (!fs.existsSync(FIXTURE_DIR)) fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const filePath = path.join(FIXTURE_DIR, filename);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, makeBuffer());
  return filePath;
}

const FIXTURES = {
  valid_image: () => ensureFixture('repliqa-test-image.png', () => Buffer.from(MINIMAL_PNG_BASE64, 'base64')),
  valid_document: () =>
    ensureFixture('repliqa-test-document.txt', () => Buffer.from('RepliQA 테스트용 업로드 문서입니다.\n', 'utf8')),
  // 실제 실행 가능한 바이너리가 아니라, 확장자 필터링을 테스트하기 위한 무해한 더미 바이트다.
  disallowed_extension: () => ensureFixture('repliqa-test-file.exe', () => Buffer.from('REPLIQA_TEST_INERT_BYTES', 'utf8')),
  oversized: () => ensureFixture('repliqa-test-oversized.bin', () => Buffer.alloc(15 * 1024 * 1024, 0)),
};

function getFixturePath(fixtureType) {
  const factory = FIXTURES[fixtureType] || FIXTURES.valid_image;
  return factory();
}

module.exports = { getFixturePath };
