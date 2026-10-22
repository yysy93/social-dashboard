// 사용법: node tests/verify.js <킼킼킼.csv> <굽굽.csv> <팔로워.csv> <매출.csv> <킼광고.csv> <굽광고.csv>
const fs = require("fs");
const P = require("../js/parser.js");
const read = (f) => P.parseCSV(fs.readFileSync(f, "utf8"));
const [k, g, f, rv, ka, ga] = process.argv.slice(2);

for (const [name, file] of [["킼킼킼", k], ["굽굽매거진", g]]) {
  const c = P.parseContent(read(file), { fromDate: "2026-01-01" });
  const t = P.aggregate(c.posts);
  console.log(`\n[${name}] 게시물 ${t.count} · 조회수 ${t.views.toLocaleString()}`);
  P.byMonth(c.posts).forEach((m) => console.log(`  ${m.month} 게시물 ${m.count} 조회수 ${m.views.toLocaleString()} 도달 ${m.reach.toLocaleString()} 공유 ${m.shares.toLocaleString()}`));
  P.verifyContent(c).forEach((v) => console.log(`  검증 ${v.month}: ${v.ok ? "✓ 시트 합계와 일치" : "✗ " + v.diffs.map((d) => `${d.metric} 시트 ${d.sheet} / 실제 ${d.calc}`).join(", ")}`));
  const top = [...c.posts].sort((a, b) => b.views - a.views)[0];
  console.log(`  1위: ${top.date} ${top.title} (${top.views.toLocaleString()})`);
}
const fo = P.parseFollowers(read(f));
Object.values(fo).forEach((ch) => {
  const a = ch.points[0], b = ch.points.at(-1);
  console.log(`\n[팔로워 ${ch.name}] 시작일 ${ch.baseline} · ${a.date} ${a.value} → ${b.date} ${b.value} (${b.value - a.value}, ${(((b.value - a.value) / a.value) * 100).toFixed(2)}%) · ${ch.points.length}개 지점`);
});
const rs = P.revenueSummary(P.parseRevenue(read(rv)));
console.log(`\n[매출] 데이터 있음: ${rs.hasData} · 총 ${rs.total} · 채널: ${rs.checks.map((c) => `${c.name} 합 ${c.calc} / 시트 총 ${c.sheet} ${c.ok ? "✓" : "✗"}`).join(" | ")}`);
for (const [name, file] of [["킼킼킼", ka], ["굽굽", ga]]) {
  const ads = P.parseAds(read(file));
  console.log(`\n[광고 문의 ${name}] ${ads.length}건`); ads.forEach((a) => console.log(`  ${a.brand} | ${a.form} | ${a.requested} | ${a.status} | ${a.confirmed}`));
}
