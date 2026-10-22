/* =========================================================
 * parser.js — 구글 시트 CSV 파싱 (브라우저 + Node 공용)
 *  - 따옴표 / 셀 안 줄바꿈 / BOM 처리
 *  - 병합 셀(빈 날짜) → 위 값으로 채움
 *  - 여러 단계 헤더 → '조회수' 같은 키워드로 헤더 행을 찾아 열 위치 결정
 *  - 시트의 '월 전체' 합계 행은 쓰지 않고 게시물 단위로 직접 집계
 * ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SheetParser = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM 제거
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* ---------- 값 정리 ---------- */
  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

  // "24,393 " / "9756" / "12000" / "3,000,000원" / "200만원" / "$12.5" → 숫자, 아니면 null
  function toNumber(v) {
    let s = clean(v).replace(/[,₩$원\s]/g, "");
    if (!s || s === "-" || /^#/.test(s)) return null; // 빈칸, '-', #REF! 등
    let mult = 1;
    const man = s.match(/^(-?[\d.]+)만$/);
    if (man) { s = man[1]; mult = 10000; }
    s = s.replace(/%$/, "");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return parseFloat(s) * mult;
  }

  // 헤더 행 찾기: 모든 키워드를 포함하는 첫 행
  function findHeaderRow(rows, keywords, from = 0) {
    for (let i = from; i < rows.length; i++) {
      const r = rows[i].map(clean);
      if (keywords.every((k) => r.some((c) => c.includes(k)))) return i;
    }
    return -1;
  }
  const colOf = (header, ...keys) =>
    header.findIndex((h) => keys.some((k) => clean(h).replace(/\s/g, "").includes(k.replace(/\s/g, ""))));

  // 날짜 셀 → "YYYY-MM-DD" (2026-07-01, 2026. 7. 1, 2026/7/1 지원)
  function toISODate(v) {
    const m = clean(v).match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  /* ---------- 1) 콘텐츠 탭 (킼킼킼 / 굽굽매거진) ---------- */
  function parseContent(rows, opts = {}) {
    const from = opts.fromDate || "0000-00-00";
    const h = findHeaderRow(rows, ["조회수", "업로드"]);
    if (h < 0) throw new Error("콘텐츠 탭에서 '업로드 날짜 / 조회수' 헤더를 찾지 못했어요.");
    const H = rows[h];
    const C = {
      date: colOf(H, "업로드"), format: colOf(H, "포맷"), title: colOf(H, "컨텐츠명", "콘텐츠명"),
      url: colOf(H, "URL", "링크"), views: colOf(H, "조회수"), reach: colOf(H, "도달"),
      likes: colOf(H, "좋아요"), comments: colOf(H, "댓글"), saves: colOf(H, "저장"),
      shares: colOf(H, "공유"), reposts: colOf(H, "리포스트"),
    };
    const posts = [];
    const sheetTotals = {}; // 시트에 적힌 월 합계 (검증용)
    let curDate = null;
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      const a = clean(r[C.date]);
      const get = (k) => (C[k] >= 0 ? toNumber(r[C[k]]) : null);
      const sm = a.match(/(\d{2})년\s*(\d{1,2})월\s*전체/);
      if (sm) {
        sheetTotals[`20${sm[1]}-${sm[2].padStart(2, "0")}`] = {
          views: get("views"), reach: get("reach"), likes: get("likes"),
          comments: get("comments"), saves: get("saves"), shares: get("shares"),
        };
        continue;
      }
      if (a.includes("전체")) continue;                 // 연간/누적 합계 행
      const d = toISODate(a);
      if (d) curDate = d;                               // 병합된 날짜 채우기
      const title = clean(r[C.title]);
      if (!curDate || !title || toNumber(title) !== null) continue; // 제목 없음 = 예정 행
      if (curDate < from) continue;
      // 링크: URL 칸이 실제 주소면 사용, 아니면 행 안의 첫 http 주소
      let url = C.url >= 0 && /^https?:\/\//.test(clean(r[C.url])) ? clean(r[C.url]) : "";
      if (!url) url = (r.map(clean).find((c) => /^https?:\/\/(www\.)?(instagram|youtu|tiktok|threads)/.test(c))) || "";
      posts.push({
        row: i + 1, date: curDate, month: curDate.slice(0, 7),
        format: clean(r[C.format]) || "기타", title, url,
        views: get("views") || 0, reach: get("reach") || 0, likes: get("likes") || 0,
        comments: get("comments") || 0, saves: get("saves") || 0,
        shares: get("shares") || 0, reposts: get("reposts") || 0,
      });
    }
    return { posts, sheetTotals };
  }

  /* ---------- 2) 팔로워 총괄표 ---------- */
  // 레이아웃: [채널명_팔로워] 제목 행 → [날짜 | 팔로워] 헤더 → '7/1' 형식 날짜. 두 채널이 좌우로 나란히.
  function parseFollowers(rows, opts = {}) {
    const year = opts.year || 2026;
    const h = findHeaderRow(rows, ["날짜", "팔로워"]);
    if (h < 0) throw new Error("팔로워 탭에서 '날짜 / 팔로워' 헤더를 찾지 못했어요.");
    const H = rows[h].map(clean);
    const out = {};
    H.forEach((cell, c) => {
      if (cell !== "날짜" || clean(H[c + 1]) !== "팔로워") return;
      // 위쪽에서 채널 제목 찾기 (예: '킼킼킼_팔로워')
      let name = "";
      for (let k = h - 1; k >= 0 && !name; k--) name = clean(rows[k][c]) || clean(rows[k][c + 1]);
      name = name.replace(/[_\s]*팔로워.*$/, "") || `채널${c}`;
      const points = []; let baseline = null; let y = year; let lastM = 0;
      for (let i = h + 1; i < rows.length; i++) {
        const d = clean(rows[i][c]); const v = toNumber(rows[i][c + 1]);
        if (/시작일/.test(d)) { baseline = v; continue; }
        const m = d.match(/^(\d{1,2})\/(\d{1,2})$/) || d.match(/^\d{4}-(\d{2})-(\d{2})/);
        if (!m || v == null) continue;                  // 빈칸, '-', 증감 요약 행 제외
        const mm = +m[1]; if (mm < lastM) y++; lastM = mm;
        points.push({ date: `${y}-${String(mm).padStart(2, "0")}-${m[2].padStart(2, "0")}`, value: v });
      }
      out[name] = { name, baseline, points };
    });
    return out;
  }

  /* ---------- 3) 월별 매출표 ---------- */
  // 레이아웃: [채널 INSTAGRAM] 제목 → [구분 | 전체매출 | 조회수 수익($) | 광고수익 | 비고] 좌우 2블록
  function parseRevenue(rows) {
    const h = findHeaderRow(rows, ["구분", "전체매출"]);
    if (h < 0) throw new Error("매출 탭에서 '구분 / 전체매출' 헤더를 찾지 못했어요.");
    const H = rows[h].map(clean);
    const out = {};
    H.forEach((cell, c) => {
      if (cell !== "구분") return;
      let name = "";
      for (let k = h - 1; k >= 0 && !name; k--) name = clean(rows[k][c]) || clean(rows[k][c + 1]);
      name = name.replace(/\s*INSTAGRAM\s*/i, "").trim() || `채널${c}`;
      const span = H.slice(c + 1, c + 6);
      const ci = (k) => { const j = span.findIndex((x) => x.replace(/\s/g, "").includes(k)); return j < 0 ? -1 : c + 1 + j; };
      const cTotal = ci("전체매출"), cView = ci("조회수수익"), cAd = ci("광고수익");
      const months = []; const sheet = {};
      for (let i = h + 1; i < rows.length; i++) {
        const label = clean(rows[i][c]).replace(/\s/g, "");
        if (!label) continue;
        const rec = {
          total: cTotal >= 0 ? toNumber(rows[i][cTotal]) : null,
          viewUSD: cView >= 0 ? toNumber(rows[i][cView]) : null,
          ad: cAd >= 0 ? toNumber(rows[i][cAd]) : null,
        };
        const m = label.match(/^(\d{1,2})월$/);
        if (m) months.push({ month: +m[1], ...rec });
        else if (label.includes("상반기")) sheet.h1 = rec.total;
        else if (label.includes("하반기")) sheet.h2 = rec.total;
        else if (label.includes("총")) sheet.total = rec.total;
      }
      out[name] = { name, months, sheet };
    });
    return out;
  }

  /* ---------- 4) 광고 / 협찬 문의 현황 ---------- */
  // '*출연 문의(특강)' 같은 '*'로 시작하는 구역부터는 제외 (개인정보 포함)
  function parseAds(rows) {
    const h = findHeaderRow(rows, ["브랜드", "진행확정"]);
    if (h < 0) throw new Error("광고 문의 탭에서 '브랜드 / 진행확정 여부' 헤더를 찾지 못했어요.");
    const H = rows[h];
    const C = {
      brand: colOf(H, "브랜드"), category: colOf(H, "카테고리"), product: colOf(H, "제품명"),
      form: colOf(H, "형태"), route: colOf(H, "문의경로"), channel: colOf(H, "업로드채널"),
      requested: colOf(H, "업로드요청"), status: colOf(H, "소통현황"), confirmed: colOf(H, "진행확정"),
      settle: colOf(H, "정산"), price: colOf(H, "단가"),
    };
    const list = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      const first = r.map(clean).find((x) => x);
      if (!first) continue;
      if (first.startsWith("*")) break;               // 다른 구역 시작 → 중단
      const g = (k) => (C[k] >= 0 ? clean(r[C[k]]) : "");
      if (!g("brand")) continue;
      const conf = g("confirmed").toUpperCase();
      list.push({
        brand: g("brand"), category: g("category"), product: g("product"), form: g("form"),
        route: g("route"), channel: g("channel"), requested: g("requested"), status: g("status"),
        confirmed: conf === "O" ? "확정" : conf === "X" ? "미확정" : (g("confirmed") || "검토 중"),
        settle: g("settle") === "X" ? "" : g("settle"), price: g("price") === "X" ? "" : g("price"),
      });
    }
    return list;
  }

  /* ---------- 집계 ---------- */
  const METRICS = ["views", "reach", "likes", "comments", "saves", "shares", "reposts"];
  function aggregate(posts) {
    const sum = Object.fromEntries(METRICS.map((k) => [k, 0]));
    posts.forEach((p) => METRICS.forEach((k) => (sum[k] += p[k])));
    return { count: posts.length, ...sum };
  }
  function byMonth(posts) {
    const m = {};
    posts.forEach((p) => (m[p.month] ||= []).push(p));
    return Object.keys(m).sort().map((k) => ({ month: k, ...aggregate(m[k]) }));
  }
  // 시트에 적힌 월 합계 vs 직접 계산 비교
  function verifyContent({ posts, sheetTotals }) {
    const calc = Object.fromEntries(byMonth(posts).map((x) => [x.month, x]));
    return Object.keys(calc).map((month) => {
      const s = sheetTotals[month]; const c = calc[month];
      const diffs = !s ? [] : ["views", "reach", "likes", "comments", "saves", "shares"]
        .filter((k) => s[k] != null && Math.abs(s[k] - c[k]) > 0.5)
        .map((k) => ({ metric: k, sheet: s[k], calc: c[k] }));
      return { month, hasSheet: !!s, ok: diffs.length === 0, diffs };
    });
  }
  // 매출: 월 합계 vs 시트 '총 매출' 비교 + 누적
  function revenueSummary(rev) {
    const channels = Object.values(rev);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const rows = months.map((m) => {
      const per = {};
      let total = null, ad = null;
      channels.forEach((ch) => {
        const r = ch.months.find((x) => x.month === m) || {};
        per[ch.name] = r.total ?? null;
        if (r.total != null) total = (total || 0) + r.total;
        if (r.ad != null) ad = (ad || 0) + r.ad;
      });
      return { month: m, per, total, ad };
    });
    let cum = 0;
    rows.forEach((r) => { if (r.total != null) cum += r.total; r.cumulative = r.total != null ? cum : null; });
    const filled = rows.filter((r) => r.total != null);
    const checks = channels.map((ch) => {
      const s = ch.months.reduce((a, r) => a + (r.total || 0), 0);
      return { name: ch.name, calc: s, sheet: ch.sheet.total ?? null,
        ok: ch.sheet.total == null || Math.abs(ch.sheet.total - s) < 0.5 };
    });
    return {
      hasData: filled.length > 0, rows,
      total: filled.reduce((a, r) => a + r.total, 0),
      adTotal: rows.reduce((a, r) => a + (r.ad || 0), 0),
      latest: filled[filled.length - 1] || null, checks,
    };
  }

  return { parseCSV, toNumber, parseContent, parseFollowers, parseRevenue, parseAds,
           aggregate, byMonth, verifyContent, revenueSummary };
});
