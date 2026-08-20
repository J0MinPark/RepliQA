// Vercel의 제로컨피그 서버리스 함수 감지는 프로젝트 루트의 api/ 디렉토리만 본다 —
// 실제 Express 앱은 src/api/server.js에 있으니, 여기서는 그걸 그대로 내보내기만 한다
// (Express 앱 자체가 module.exports = app이라 Vercel의 Node 런타임이 요청 핸들러로
// 그대로 받는다).
module.exports = require('../src/api/server');
