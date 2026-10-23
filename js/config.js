/* =========================================================
 * config.js — 이 파일만 수정하면 됩니다.
 * ========================================================= */
window.DASHBOARD_CONFIG = {
  title: "소셜링 파워페이지 대시보드",

  // 구글 시트 주소 .../spreadsheets/d/[여기]/edit 부분
  sheetId: "10_Vsdl_oEJVoiDcxbNxp7IL35wcHT5rDVfqe7wib36k",

  // (선택) '파일 → 공유 → 웹에 게시'를 쓰면 .../d/e/[여기]/pub 부분을 넣으세요. 비워 두면 링크 공유 방식 사용.
  publishedKey: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRFzI8QNvUrCYBHTXHzsZd3hs1RGAZDKMXKwNMYx8EDabdOIXKAvA2WKspmTipM6fCmdQ0_AsHX5C_7/pub?gid=1464159702&single=true&output=csv",

  // 이 날짜 이후 게시물만 집계 (23~24년 롱폼 제외)
  fromDate: "2026-01-01",
  year: 2026,

  // 자동 새로고침 간격(분). 0이면 끔
  autoRefreshMinutes: 5,

  // 각 탭 정보
  //  - sheet: 탭 이름 (시트 하단 탭에 보이는 이름과 띄어쓰기까지 똑같이)
  //  - gid  : 탭을 클릭했을 때 주소창 끝 '#gid=숫자'의 숫자. 넣으면 탭 이름보다 우선합니다(권장).
  //  - expect: 잘못된 탭을 읽지 않도록, CSV 첫 부분에 있어야 하는 글자
  channels: [
    { key: "kikiki", name: "킼킼킼", color: "kikiki",
      content: { sheet: "킼킼킼", gid: "1464159702", expect: ["킼킼킼"] },
      ads:     { sheet: "킼킼킼_광고 / 협찬 문의 현황", gid: "1016899569", expect: ["킼", "킥"] } },
    { key: "gugu", name: "굽굽매거진", color: "gugu",
      content: { sheet: "굽굽매거진", gid: "1052192683", expect: ["굽굽"] },
      ads:     { sheet: "굽굽_광고 / 협찬 문의 현황", gid: "1883486237", expect: ["굽굽"] } },
  ],
  followers: { sheet: "팔로워 총괄표 2026", gid: "2110976692", expect: ["팔로워"] },
  revenue:   { sheet: "월별 매출표 2026", gid: "2044720759", expect: ["INSTAGRAM", "매출"] },
};
