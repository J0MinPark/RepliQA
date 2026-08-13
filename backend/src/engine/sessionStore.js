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

// 캡처한 로그인 세션(쿠키+로컬스토리지)을 저장하는 곳. Firestore 문서 필드는 1MiB
// 제한이 있는데, Notion처럼 로컬스토리지를 많이 쓰는 SPA는 암호화 후 1MiB를 가볍게
// 넘겨서(실제로 확인함: 1.3MB 원본 → 암호화+base64 후 1.8MB) 문서에 직접 넣을 수 없다.
// 스크린샷과 동일하게 Storage에 텍스트 blob으로 올리고, Firestore에는 경로만 남긴다.
async function uploadEncryptedSession(path, jsonText) {
  const buffer = Buffer.from(jsonText, 'utf8');
  if (useSupabase()) {
    const { error } = await getSupabase()
      .storage.from(env.supabaseScreenshotBucket)
      .upload(path, buffer, { contentType: 'application/json', upsert: true });
    if (error) throw new Error(`Supabase 업로드 실패: ${error.message}`);
    return path;
  }
  await bucket.file(path).save(buffer, { contentType: 'application/json' });
  return path;
}

async function downloadEncryptedSession(path) {
  if (useSupabase()) {
    const { data, error } = await getSupabase().storage.from(env.supabaseScreenshotBucket).download(path);
    if (error) throw new Error(`Supabase 다운로드 실패: ${error.message}`);
    return Buffer.from(await data.arrayBuffer()).toString('utf8');
  }
  const [buf] = await bucket.file(path).download();
  return buf.toString('utf8');
}

module.exports = { uploadEncryptedSession, downloadEncryptedSession };
