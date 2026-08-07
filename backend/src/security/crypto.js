const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  if (!env.credentialEncryptionKey) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY가 설정되지 않았습니다. `openssl rand -base64 32`로 생성해 .env에 추가하세요.'
    );
  }
  const key = Buffer.from(env.credentialEncryptionKey, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY는 base64로 인코딩된 32바이트 키여야 합니다.');
  }
  return key;
}

// 테스트 계정 자격증명처럼 평문으로 로그·DB에 남으면 안 되는 값을 암호화한다.
function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptSecret({ ciphertext, iv, authTag }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
