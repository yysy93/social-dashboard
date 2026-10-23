/* =========================================================
 * app.js — 데이터 불러오기 + 화면 그리기
 * ========================================================= */
(function () {
  "use strict";
  const CFG = window.DASHBOARD_CONFIG;
  const P = window.SheetParser;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (n == null ? "-" : Math.round(n).toLocaleString("ko-KR"));
  const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString("ko-KR");
  const pct = (n, d = 2) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
  const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmt(Math.abs(n))}`;
  const won = (n) => (n == null ? "-" : `${fmt(n)}원`);
  const compact = (n) => new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  const monthLabel = (m) => `${m.slice(2, 4)}년 ${+m.slice(5, 7)}월`;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  document.title = CFG.title;
  $("#title").textContent = CFG.title;

  /* ---------- 데이터 소스 ---------- */
  const SOURCES = [];
  CFG.channels.forEach((ch) => {
    SOURCES.push({ id: `${ch.key}-content`, label: `${ch.name} 콘텐츠`, ...ch.content });
    SOURCES.push({ id: `${ch.key}-ads`, label: `${ch.name} 광고 문의`, ...ch.ads });
  });
  SOURCES.push({ id: "followers", label: "팔로워 총괄표", ...CFG.followers });
  SOURCES.push({ id: "revenue", label: "월별 매출표", ...CFG.revenue });

  const uploaded = {};   // 직접 업로드한 CSV (id → rows)
  const loaded = {};     // id → rows
  const errors = {};     // id → { message, tried }

  // '웹에 게시' 주소 전체를 붙여 넣어도, 2PACX-… 부분만 넣어도 동작
  const PUB_KEY = (() => {
    const v = String(CFG.publishedKey || "").trim();
    const m = v.match(/\/d\/e\/([^/?#]+)/);
    return m ? m[1] : v;
  })();

  function urlsFor(src) {
    const bust = `_=${Date.now()}`;
    const list = [];
    // 1순위: 웹에 게시(CSV) — 시트에 보이는 값 그대로 내려줌 (가장 정확)
    if (PUB_KEY && src.gid)
      list.push(`https://docs.google.com/spreadsheets/d/e/${PUB_KEY}/pub?gid=${src.gid}&single=true&output=csv&${bust}`);
    // 2순위: 내보내기(CSV) — 다운로드와 같은 형식
    if (src.gid) list.push(`https://docs.google.com/spreadsheets/d/${CFG.sheetId}/export?format=csv&gid=${src.gid}&${bust}`);
    // 3순위: gviz — 열마다 숫자/글자 중 많은 쪽만 남기고 나머지 글자를 지우는 경우가 있어 마지막에 시도
    const base = `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/gviz/tq?tqx=out:csv&headers=0`;
    if (src.gid) list.push(`${base}&gid=${src.gid}&${bust}`);
    if (src.sheet) list.push(`${base}&sheet=${encodeURIComponent(src.sheet)}&${bust}`);
    return list;
  }

  // 한글 인코딩: UTF-8로 엄격하게 읽고, 깨지면 EUC-KR(CP949, 엑셀 저장본)로 재시도
  function decode(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch (_) { return new TextDecoder("euc-kr").decode(buf); }
  }

  function checkExpected(src, text) {
    const head = text.slice(0, 600);
    if (/^\s*<(!doctype|html)/i.test(head))
      throw new Error("CSV 대신 로그인 페이지가 왔어요. 시트 공유를 '링크가 있는 모든 사용자: 뷰어'로 바꿔 주세요.");
    if (src.expect && !src.expect.some((k) => head.includes(k)))
      throw new Error(`데이터 일부가 빠진 채로 왔어요. config.js에 '웹에 게시' 주소(publishedKey)를 넣어 주세요. gid가 맞는지도 확인해 주세요. (찾는 글자: ${src.expect.join(" 또는 ")})`);
  }

  async function fetchSource(src) {
    if (uploaded[src.id]) return uploaded[src.id];
    const tried = [];
    for (const url of urlsFor(src)) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = decode(await res.arrayBuffer());
        checkExpected(src, text);
        console.info(`[dashboard] ${src.label} ← ${url}`);
        return P.parseCSV(text);
      } catch (e) {
        const msg = e instanceof TypeError
          ? "브라우저가 요청을 차단했어요(CORS 또는 네트워크 오류)."
          : e.message;
        tried.push({ url, msg });
        console.warn(`[dashboard] ${src.label} 실패: ${url}`, e);
      }
    }
    const err = new Error(tried.length ? tried[tried.length - 1].msg : "탭 이름이나 gid가 설정되지 않았어요.");
    err.tried = tried;
    throw err;
  }

  /* ---------- 로딩 ---------- */
  async function loadAll() {
    setStatus("데이터 불러오는 중…");
    const results = await Promise.allSettled(SOURCES.map(fetchSource));
    results.forEach((r, i) => {
      const id = SOURCES[i].id;
      if (r.status === "fulfilled") { loaded[id] = r.value; delete errors[id]; }
      else { delete loaded[id]; errors[id] = { message: r.reason.message, tried: r.reason.tried || [] }; }
    });
    buildModel();
    dataReady = true;
    render();
    const nErr = Object.keys(errors).length;
    const time = new Date().toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    setStatus(nErr ? `${SOURCES.length - nErr}/${SOURCES.length}개 탭 불러옴 · ${time}` : `최신 데이터 · ${time} 업데이트`, nErr ? "err" : "ok");
  }
  function setStatus(t, cls = "") { const el = $("#status"); el.textContent = t; el.className = `status ${cls}`; }

  /* ---------- 모델 ---------- */
  let M = {};
  function buildModel() {
    M = { channels: {}, followers: null, revenue: null, parseErrors: {} };
    const safe = (id, fn) => { if (!loaded[id]) return null; try { return fn(loaded[id]); } catch (e) { errors[id] = { message: e.message, tried: [] }; return null; } };
    CFG.channels.forEach((ch) => {
      M.channels[ch.key] = {
        ...ch,
        content: safe(`${ch.key}-content`, (rows) => P.parseContent(rows, { fromDate: CFG.fromDate })),
        ads: safe(`${ch.key}-ads`, P.parseAds),
      };
    });
    M.followers = safe("followers", (rows) => P.parseFollowers(rows, { year: CFG.year }));
    M.revenue = safe("revenue", (rows) => P.revenueSummary(P.parseRevenue(rows)));
  }
  const followerOf = (ch) => {
    if (!M.followers) return null;
    const keys = Object.keys(M.followers);
    const k = keys.find((x) => x === ch.name) || keys.find((x) => x.includes(ch.name.slice(0, 2)) || ch.name.includes(x));
    return k ? M.followers[k] : null;
  };
  const revenueKey = (ch, names) => names.find((x) => x === ch.name) || names.find((x) => x.includes(ch.name.slice(0, 2)));

  /* ---------- 공통 차트 ---------- */
  const charts = {};
  function chart(key, canvas, config) {
    charts[key]?.destroy();
    const c = css("--text-2"), g = css("--grid");
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = c;
    const base = {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: css("--card"), titleColor: css("--text"), bodyColor: css("--text"),
          borderColor: css("--line"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true },
      },
      scales: {
        x: { grid: { display: false }, border: { color: g }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
        y: { grid: { color: g }, border: { display: false }, ticks: { callback: (v) => compact(v), maxTicksLimit: 5 } },
      },
    };
    config.options = deepMerge(base, config.options || {});
    charts[key] = new Chart(canvas, config);
  }
  function deepMerge(a, b) {
    const o = { ...a };
    for (const k in b) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && typeof b[k] !== "function" ? deepMerge(a[k] || {}, b[k]) : b[k];
    return o;
  }
  const legendHTML = (items) => items.map(([cls, name]) => `<span><i class="dot ${cls}"></i>${esc(name)}</span>`).join("");

  /* ---------- 렌더 ---------- */
  function render() {
    renderErrors();
    renderPeriodOptions();
    renderFollowers();
    renderRevenue();
    renderChannels();
    renderVerify();
  }

  function renderErrors() {
    const ids = Object.keys(errors);
    const box = $("#errors");
    if (!ids.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="error-box" role="alert">
      <h3>일부 데이터를 불러오지 못했어요</h3>
      <p class="hint">임의의 데이터로 채우지 않았어요. 원인을 해결하거나 해당 탭의 CSV 파일을 직접 올려 주세요. (시트: 파일 → 다운로드 → 쉼표로 구분된 값)</p>
      <ul>${ids.map((id) => {
        const s = SOURCES.find((x) => x.id === id);
        return `<li><b>${esc(s.label)}</b> — ${esc(errors[id].message)}
          ${errors[id].tried.map((t) => `<br><code>${esc(t.url.replace(/&_=\d+/, ""))}</code>`).join("")}
          <div class="upload-row"><label class="btn">CSV 올리기<input type="file" accept=".csv,text/csv" data-id="${id}" hidden></label></div></li>`;
      }).join("")}</ul></div>`;
    box.querySelectorAll("input[type=file]").forEach((inp) => inp.addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const src = SOURCES.find((x) => x.id === e.target.dataset.id);
      const text = decode(await f.arrayBuffer());
      try { checkExpected(src, text); } catch (err) { alert(err.message); return; }
      uploaded[src.id] = P.parseCSV(text);
      loadAll();
    }));
  }

  let period = "all";
  function renderPeriodOptions() {
    const months = new Set();
    Object.values(M.channels).forEach((c) => c.content?.posts.forEach((p) => months.add(p.month)));
    const sel = $("#period");
    const cur = sel.value || "all";
    sel.innerHTML = `<option value="all">${CFG.year % 100}년 전체</option>` +
      [...months].sort().map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("");
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "all";
    period = sel.value;
  }

  /* ① 팔로워 */
  function renderFollowers() {
    const wrap = $("#follower-cards");
    const data = CFG.channels.map((ch) => ({ ch, f: followerOf(ch) })).filter((x) => x.f && x.f.points.length);
    if (!data.length) { wrap.innerHTML = `<p class="hint">팔로워 데이터를 불러오지 못했어요.</p>`; charts.followers?.destroy(); return; }
    const total = data.reduce((a, x) => a + x.f.points.at(-1).value, 0);
    wrap.innerHTML = data.map(({ ch, f }) => {
      const first = f.points[0], last = f.points.at(-1);
      const d = last.value - first.value, r = (d / first.value) * 100;
      const mStart = f.points.find((p) => p.date.slice(0, 7) === last.date.slice(0, 7));
      const md = last.value - mStart.value;
      return `<div class="f-card ${ch.color}">
        <div class="f-name"><i class="dot ${ch.color}"></i>${esc(ch.name)}</div>
        <div class="f-num">${fmt(last.value)}<span class="hint" style="font-size:14px;font-weight:500"> 명</span></div>
        <div class="f-delta">${+first.date.slice(5, 7)}/${+first.date.slice(8)} 대비 <span class="${d >= 0 ? "delta-up" : "delta-down"}">${d >= 0 ? "▲" : "▼"} ${signed(d)} (${pct(r)})</span></div>
        <div class="f-delta">이번 달 ${signed(md)}${f.baseline ? ` · 시작일 기준값 ${fmt(f.baseline)}` : ""}</div>
      </div>`;
    }).join("") + `<div>
      <div class="share-bar">${data.map(({ ch, f }) => `<span class="bg-${ch.color}" style="width:${(f.points.at(-1).value / total) * 100}%"></span>`).join("")}</div>
      <div class="share-legend">${data.map(({ ch, f }) => `<span>${esc(ch.name)} ${fmt1((f.points.at(-1).value / total) * 100)}%</span>`).join("")}<span>합계 ${fmt(total)}명</span></div>
    </div>`;

    const last = data[0].f.points.at(-1).date;
    $("#followers-range").textContent = `${data[0].f.points[0].date} ~ ${last} · 측정 ${data[0].f.points.length}회`;
    $("#follower-legend").innerHTML = legendHTML(data.map(({ ch }) => [ch.color, ch.name]));
    const dates = [...new Set(data.flatMap((x) => x.f.points.map((p) => p.date)))].sort();
    chart("followers", $("#followerChart"), {
      type: "line",
      data: {
        labels: dates.map((d) => `${+d.slice(5, 7)}/${+d.slice(8)}`),
        datasets: data.map(({ ch, f }) => {
          const base = f.points[0].value; const map = Object.fromEntries(f.points.map((p) => [p.date, p.value]));
          return { label: ch.name, raw: dates.map((d) => map[d] ?? null),
            data: dates.map((d) => (map[d] == null ? null : ((map[d] - base) / base) * 100)),
            borderColor: css(`--${ch.color}`), backgroundColor: css(`--${ch.color}`),
            borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, spanGaps: true, tension: 0.25 };
        }),
      },
      options: {
        scales: { y: { ticks: { callback: (v) => `${v}%` } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} ${fmt(c.dataset.raw[c.dataIndex])}명 (${pct(c.parsed.y)})` } } },
      },
    });
  }

  /* ② 매출 */
  function renderRevenue() {
    const R = M.revenue;
    const cards = $("#revenue-cards");
    const card = (label, value, foot = "") => `<div class="card kpi"><div class="label">${label}</div>
      <div class="value ${value == null ? "na" : ""}">${value == null ? "미입력" : won(value)}</div>${foot ? `<div class="foot">${foot}</div>` : ""}</div>`;
    if (!R) {
      cards.innerHTML = card("총 매출", null) + card("누적 매출", null) + card("이번 달 매출", null) + card("광고 수익", null);
      $("#revenue-charts").hidden = true; $("#revenue-empty").hidden = true; $("#revenue-check").textContent = "";
      return;
    }
    const L = R.latest;
    const names = Object.keys(R.rows[0].per);
    cards.innerHTML =
      card("총 매출", R.hasData ? R.total : null, R.hasData ? names.map((n) => `${esc(n)} ${won(R.rows.reduce((a, r) => a + (r.per[n] || 0), 0))}`).join(" · ") : "") +
      card("누적 매출", L ? L.cumulative : null, L ? `1월 ~ ${L.month}월 누적` : "") +
      card("이번 달 매출", L ? L.total : null, L ? `${L.month}월 (최근 입력 월)` : "") +
      card("광고 수익", R.hasData && R.adTotal ? R.adTotal : null, R.hasData ? "광고수익 칸 합계" : "");
    $("#revenue-check").innerHTML = !R.hasData ? "시트에 금액 미입력"
      : R.checks.map((c) => c.sheet == null ? `${esc(c.name)} 원본 총매출 칸 비어 있음`
        : `${esc(c.name)} ${c.ok ? '<span class="ok-t">✓ 원본 총매출과 일치</span>' : `<span class="bad-t">✗ 원본 ${won(c.sheet)} / 계산 ${won(c.calc)}</span>`}`).join(" · ");
    $("#revenue-charts").hidden = !R.hasData;
    $("#revenue-empty").hidden = R.hasData;
    if (!R.hasData) { charts.revenue?.destroy(); charts.cumulative?.destroy(); return; }

    const chs = CFG.channels.map((ch) => ({ ch, key: revenueKey(ch, names) })).filter((x) => x.key);
    $("#revenue-legend").innerHTML = legendHTML(chs.map(({ ch }) => [ch.color, ch.name]));
    const lastM = L.month;
    const rows = R.rows.filter((r) => r.month <= lastM);
    chart("revenue", $("#revenueChart"), {
      type: "bar",
      data: { labels: rows.map((r) => `${r.month}월`),
        datasets: chs.map(({ ch, key }) => ({ label: ch.name, data: rows.map((r) => r.per[key]),
          backgroundColor: css(`--${ch.color}`), borderRadius: 4, borderSkipped: "start",
          categoryPercentage: 0.7, barPercentage: 0.9 })) },
      options: { plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} ${c.parsed.y == null ? "미입력" : won(c.parsed.y)}` } } } },
    });
    chart("cumulative", $("#cumulativeChart"), {
      type: "line",
      data: { labels: rows.map((r) => `${r.month}월`),
        datasets: [{ label: "누적 매출", data: rows.map((r) => r.cumulative), borderColor: css("--text"), backgroundColor: css("--text"),
          borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, spanGaps: true }] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => ` 누적 ${won(c.parsed.y)}` } } } },
    });
  }

  /* ③④ 채널 */
  function renderChannels() {
    const host = $("#channels");
    const tabs = $("#channel-tabs");
    tabs.innerHTML = CFG.channels.map((ch) => `<button role="tab" data-key="${ch.key}" aria-selected="${host.dataset.active === ch.key}">${esc(ch.name)}</button>`).join("");
    tabs.querySelectorAll("button").forEach((b) => b.onclick = () => {
      host.dataset.active = b.dataset.key;
      tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", x === b));
      Object.values(charts).forEach((c) => c.resize());
    });
    const view = document.body.dataset.view;
    const solo = CFG.channels.some((c) => c.key === view);
    if (solo) host.dataset.active = view;          // 모바일에서도 선택한 채널이 보이도록
    const topN = solo ? 10 : 5;
    host.innerHTML = "";
    CFG.channels.forEach((cfg) => {
      const ch = M.channels[cfg.key];
      const el = $("#tpl-channel").content.firstElementChild.cloneNode(true);
      el.dataset.key = cfg.key;
      $(".dot", el).classList.add(cfg.color);
      $(".ch-name", el).textContent = cfg.name;
      host.appendChild(el);
      renderAds(el, ch.ads);
      if (!ch.content) { $(".ch-kpis", el).innerHTML = `<p class="hint">콘텐츠 데이터를 불러오지 못했어요.</p>`; [".top-card"].forEach((s) => ($(s, el).hidden = true)); return; }

      const all = ch.content.posts;
      const posts = period === "all" ? all : all.filter((p) => p.month === period);
      const t = P.aggregate(posts);
      const avg = t.count ? t.views / t.count : 0;
      $(".ch-period", el).textContent = period === "all" ? `${monthLabel(all[0]?.month || "2026-01")} ~ ${monthLabel(all.at(-1)?.month || "2026-01")}` : monthLabel(period);
      const k = (label, value, foot) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="foot">${foot}</div></div>`;
      $(".ch-kpis", el).innerHTML =
        k("게시물", fmt(t.count), `단일 ${posts.filter((p) => p.format === "단일").length} · 캐러셀 ${posts.filter((p) => p.format === "캐러셀").length}`) +
        k("총 조회수", fmt(t.views), `도달 ${fmt(t.reach)}`) +
        k("평균 조회수", fmt(avg), `중앙값 ${fmt(median(posts.map((p) => p.views)))}`) +
        k("총 공유", fmt(t.shares), `좋아요 ${fmt(t.likes)} · 저장 ${fmt(t.saves)}`);

      // 1위 콘텐츠 + 인사이트
      const sorted = [...posts].sort((a, b) => b.views - a.views);
      const top = sorted[0];
      if (top) {
        $(".top-meta", el).textContent = `${top.date} · ${top.format}`;
        $(".top-title", el).textContent = top.title;
        $(".top-stats", el).innerHTML = [["조회수", top.views], ["도달", top.reach], ["좋아요", top.likes], ["저장", top.saves], ["공유", top.shares], ["댓글", top.comments]]
          .map(([l, v]) => `<span>${l} <b>${fmt(v)}</b></span>`).join("");
        $(".insights", el).innerHTML = insights(top, posts, t).map((s) => `<li>${s}</li>`).join("");
        const a = $(".top-link", el);
        if (top.url) a.href = top.url;
        else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); a.textContent = "링크 미입력 · 시트에 URL 주소 필요"; }
      } else $(".top-card", el).hidden = true;

      // 월별 조회수
      const months = P.byMonth(all);
      chart(`${cfg.key}-month`, $(".ch-month", el), {
        type: "bar",
        data: { labels: months.map((m) => monthLabel(m.month)),
          datasets: [{ label: "조회수", data: months.map((m) => m.views), borderRadius: 4, borderSkipped: "start", categoryPercentage: 0.6,
            backgroundColor: months.map((m) => period === "all" || m.month === period ? css(`--${cfg.color}`) : css("--grid")) }] },
        options: { plugins: { tooltip: { callbacks: { label: (c) => ` 조회수 ${fmt(c.parsed.y)} · 게시물 ${months[c.dataIndex].count}개` } } } },
      });

      // 포맷별 평균
      const fm = {};
      posts.forEach((p) => (fm[p.format] ||= []).push(p.views));
      const fmts = Object.keys(fm).sort((a, b) => avgOf(fm[b]) - avgOf(fm[a]));
      chart(`${cfg.key}-format`, $(".ch-format", el), {
        type: "bar",
        data: { labels: fmts, datasets: [{ label: "평균 조회수", data: fmts.map((f) => avgOf(fm[f])),
          backgroundColor: css(`--${cfg.color}`), borderRadius: 4, borderSkipped: "start", categoryPercentage: 0.6 }] },
        options: { indexAxis: "y",
          scales: { x: { grid: { color: css("--grid") }, ticks: { callback: (v) => compact(v), maxTicksLimit: 5 } }, y: { grid: { display: false } } },
          plugins: { tooltip: { callbacks: { label: (c) => ` 평균 ${fmt(c.parsed.x)} · ${fm[fmts[c.dataIndex]].length}개` } } } },
      });

      // TOP 5
      $(".top-n-title", el).textContent = `조회수 TOP ${topN}`;
      $(".ch-top", el).innerHTML = sorted.slice(0, topN).map((p, i) => `<tr>
        <td>${i + 1}</td>
        <td class="t-title">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}<div class="t-sub">${p.date} · ${esc(p.format)}</div></td>
        <td class="num">${fmt(p.views)}</td><td class="num">${fmt(p.shares)}</td></tr>`).join("") || `<tr><td colspan="4" class="hint">게시물이 없어요.</td></tr>`;
    });
  }
  const avgOf = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  function insights(top, posts, t) {
    const out = [];
    const avg = t.views / t.count;
    if (posts.length > 1) out.push(`평균 조회수(${fmt(avg)})의 <b>${fmt1(top.views / avg)}배</b>를 기록했어요.`);
    if (t.views) out.push(`이 기간 전체 조회수의 <b>${fmt1((top.views / t.views) * 100)}%</b>를 이 콘텐츠 1개가 차지해요.`);
    const sr = top.views ? (top.shares / top.views) * 100 : 0;
    const avgSr = t.views ? (t.shares / t.views) * 100 : 0;
    if (top.shares) out.push(`공유율 <b>${fmt1(sr)}%</b> (조회 100회당 ${fmt1(sr)}회 공유)${avgSr ? ` · 채널 평균 ${fmt1(avgSr)}%` : ""}${avgSr ? ` — 평균보다 ${sr >= avgSr ? "높아요" : "낮아요"}` : ""}`);
    const same = posts.filter((p) => p.format === top.format);
    if (same.length > 1 && posts.length > same.length) out.push(`${esc(top.format)} 포맷 평균(${fmt(avgOf(same.map((p) => p.views)))}) 대비 <b>${fmt1(top.views / avgOf(same.map((p) => p.views)))}배</b>예요.`);
    if (top.reach && t.reach) {
      const r = top.views / top.reach, avgR = t.views / t.reach;
      out.push(`도달 1명당 <b>${fmt1(r)}회</b> 조회 (채널 평균 ${fmt1(avgR)}회)${Math.abs(r - avgR) >= 0.2 ? ` — ${r > avgR ? "평소보다 반복 시청이 많았어요." : "평소보다 새로운 사람에게 넓게 노출됐어요."}` : ""}`);
    }
    const likeR = top.views ? (top.likes / top.views) * 100 : 0, avgLike = t.views ? (t.likes / t.views) * 100 : 0;
    if (top.likes && avgLike) out.push(`좋아요율 <b>${fmt1(likeR)}%</b> (채널 평균 ${fmt1(avgLike)}%)`);
    return out;
  }

  function renderAds(el, ads) {
    const box = $(".ads", el);
    if (!ads) { box.innerHTML = `<p class="ads-empty">광고 문의 데이터를 불러오지 못했어요.</p>`; return; }
    const conf = ads.filter((a) => a.confirmed === "확정").length;
    $(".ch-ads-count", el).textContent = `총 ${ads.length}건 · 확정 ${conf}건`;
    box.innerHTML = ads.length ? ads.map((a) => `<div class="ad">
      <div class="ad-top"><span class="ad-brand">${esc(a.brand)}</span>
        <span class="badges">${a.status ? `<span class="badge">${esc(a.status)}</span>` : ""}
        <span class="badge ${a.confirmed === "확정" ? "good" : a.confirmed === "미확정" ? "" : "warn"}">${a.confirmed === "확정" ? "✓ " : a.confirmed === "미확정" ? "○ " : "… "}${esc(a.confirmed)}</span></span></div>
      <div class="ad-meta">${[a.category, a.product].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="ad-meta">${[a.form && `형태 ${a.form}`, a.route && `경로 ${a.route}`, a.requested && `요청일 ${a.requested}`, a.price && `단가 ${a.price}`].filter(Boolean).map(esc).join(" · ")}</div>
    </div>`).join("") : `<p class="ads-empty">등록된 문의가 없어요.</p>`;
  }

  /* 검증 */
  const LABEL = { views: "조회수", reach: "도달", likes: "좋아요", comments: "댓글", saves: "저장", shares: "공유" };
  function renderVerify() {
    const html = CFG.channels.map((cfg) => {
      const c = M.channels[cfg.key].content;
      if (!c) return "";
      const rows = P.verifyContent(c);
      return `<div class="v-ch"><h3>${esc(cfg.name)}</h3><div class="table-wrap"><table class="tbl">
        <thead><tr><th>월</th><th class="num">게시물</th><th class="num">조회수(계산)</th><th>시트 월 합계와 비교</th></tr></thead><tbody>
        ${rows.map((v) => {
          const m = P.byMonth(c.posts).find((x) => x.month === v.month);
          return `<tr><td>${monthLabel(v.month)}</td><td class="num">${fmt(m.count)}</td><td class="num">${fmt(m.views)}</td><td>${
            !v.hasSheet ? '<span class="hint">시트 합계 행 없음</span>'
            : v.ok ? '<span class="ok-t">✓ 일치</span>'
            : `<span class="bad-t">✗ 불일치</span> <span class="hint">${v.diffs.map((d) => `${LABEL[d.metric]} 시트 ${fmt(d.sheet)} → 실제 ${fmt(d.calc)}`).join(", ")}</span>`}</td></tr>`;
        }).join("")}</tbody></table></div></div>`;
    }).join("");
    $("#verify").innerHTML = `<p class="hint">대시보드는 시트의 '월 전체' 합계 행을 쓰지 않고 게시물별 값을 직접 더해 표시합니다. 불일치는 시트 합계 수식 범위가 일부 행을 빠뜨린 경우예요.</p>${html}`;
  }

  /* ---------- 이벤트 ---------- */
  $("#period").addEventListener("change", (e) => { period = e.target.value; renderChannels(); });
  $("#refresh").addEventListener("click", loadAll);

  /* ---------- 보기 탭 (주소 끝 #overview, #followers, #revenue, #kikiki, #gugu) ---------- */
  const VIEWS = ["overview", "followers", "revenue", ...CFG.channels.map((c) => c.key)];
  let dataReady = false;
  function applyView() {
    const h = location.hash.slice(1);
    const view = VIEWS.includes(h) ? h : "overview";
    document.body.dataset.view = view;
    document.querySelectorAll("#view-tabs a").forEach((a) => {
      if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (dataReady) render();                       // 보이게 된 차트를 올바른 크기로 다시 그림
  }
  window.addEventListener("hashchange", () => { applyView(); window.scrollTo({ top: 0 }); });
  applyView();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  if (CFG.autoRefreshMinutes > 0) setInterval(() => { if (!document.hidden) loadAll(); }, CFG.autoRefreshMinutes * 60000);

  loadAll();
})();
