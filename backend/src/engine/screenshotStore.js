const { bucket } = require('../db/firestore');
const env = require('../config/env');

let supabaseClient = null;
function getSupabase() {
  if (!supabaseClient) {
    const { createClient } = require('@supabase/supabase-js');
    supabaseClient = createClient(env.supabaseUrl, env.supabaseServiceKey);
  }
  return supabaseClient;
}

const useSupabase = () => Boolean(env.supabaseUrl && env.supabaseServiceKey);

// 스텝마다 찍는 스크린샷 저장소. Supabase 환경변수가 설정돼 있으면(운영 배포 기본값 —
// Firebase Storage는 2026-02부터 카드 등록 없인 못 씀) Supabase Storage를, 아니면(로컬
// 개발 기본값) 지금까지처럼 Firebase Storage 에뮬레이터를 그대로 쓴다.
async function uploadScreenshot(path, buffer) {
  if (useSupabase()) {
    const { error } = await getSupabase()
      .storage.from(env.supabaseScreenshotBucket)
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`Supabase 업로드 실패: ${error.message}`);
    return path;
  }
  await bucket.file(path).save(buffer, { contentType: 'image/jpeg' });
  return path;
}

// 프론트는 이 URL을 직접 못 만든다(서명/인증 필요) — 백엔드가 자기 테넌트 소유 확인 후
// 대신 발급해준다. Firebase 경로는 서명 URL 대신 admin SDK로 직접 내려받아 data URI로
// 반환한다 — 에뮬레이터는 V4 서명을 지원하지 않아서, admin 권한으로 바이트를 바로 읽는
// 쪽이 로컬/운영 모두에서 동일하게 동작한다.
async function getScreenshotUrl(path) {
  if (useSupabase()) {
    const { data, error } = await getSupabase()
      .storage.from(env.supabaseScreenshotBucket)
      .createSignedUrl(path, 600);
    if (error) throw new Error(`Supabase 서명 URL 발급 실패: ${error.message}`);
    return data.signedUrl;
  }
  const [buf] = await bucket.file(path).download();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// Supabase Storage는 GCS와 달리 prefix 한 번에 재귀 삭제하는 API가 없어서, list()가
// 반환하는 항목 중 id가 있으면 파일·없으면 폴더(placeholder)라는 규약을 이용해 직접
// 재귀적으로 순회한다. 계정 탈퇴 시 스크린샷+캡처된 로그인 세션(sessionStore.js도 같은
// 버킷·같은 tenants/{tenantId}/ 프리픽스를 쓴다) 전부를 한 번에 정리하기 위한 용도.
async function deleteSupabaseFolder(folder) {
  const client = getSupabase();
  const { data, error } = await client.storage.from(env.supabaseScreenshotBucket).list(folder, { limit: 1000 });
  if (error || !data || data.length === 0) return;

  const filePaths = [];
  for (const entry of data) {
    const entryPath = `${folder}/${entry.name}`;
    if (entry.id) {
      filePaths.push(entryPath);
    } else {
      await deleteSupabaseFolder(entryPath);
    }
  }
  if (filePaths.length > 0) {
    await client.storage.from(env.supabaseScreenshotBucket).remove(filePaths);
  }
}

async function deleteTenantStorage(tenantId) {
  const prefix = `tenants/${tenantId}`;
  if (useSupabase()) {
    await deleteSupabaseFolder(prefix);
  } else {
    await bucket.deleteFiles({ prefix: `${prefix}/` });
  }
}

module.exports = { uploadScreenshot, getScreenshotUrl, deleteTenantStorage };
