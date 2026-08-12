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

module.exports = { uploadScreenshot, getScreenshotUrl };
