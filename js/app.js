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
    renderAdsOverview();
    renderUploads();
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
      const fo = followerOf(cfg);
      if (fo && fo.points.length) {
        const a = fo.points[0], b = fo.points.at(-1), d = b.value - a.value;
        $(".ch-follow", el).innerHTML = `팔로워 <b>${fmt(b.value)}</b>명 <span class="${d >= 0 ? "delta-up" : "delta-down"}">${d >= 0 ? "▲" : "▼"} ${signed(d)} (${pct((d / a.value) * 100)})</span>`;
      }
      host.appendChild(el);
      renderAds(el, ch.ads);
      if (solo) renderFollowCard(el, cfg); else $(".follow-card", el).remove();
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
  // 채널 탭 전용 팔로워 카드: 현재 수 · 증감 · 추이 차트 · 월별 증감표
  function renderFollowCard(el, cfg) {
    const card = $(".follow-card", el);
    const f = followerOf(cfg);
    if (!f || !f.points.length) { $(".fc-stats", card).innerHTML = `<p class="hint">팔로워 데이터를 불러오지 못했어요.</p>`; return; }
    const pts = f.points, first = pts[0], last = pts.at(-1);
    const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
    const delta = (a, b) => { const d = b - a; return `<span class="${d >= 0 ? "delta-up" : "delta-down"}">${d >= 0 ? "▲" : "▼"} ${signed(d)} (${pct((d / a) * 100)})</span>`; };
    const byM = {}; pts.forEach((p) => (byM[p.date.slice(0, 7)] ||= []).push(p));
    const months = Object.keys(byM).sort();
    const thisM = byM[months.at(-1)];
    const peak = pts.reduce((a, b) => (b.value > a.value ? b : a));
    $(".fc-range", card).textContent = `${first.date} ~ ${last.date} · 측정 ${pts.length}회`;
    // 접힌 상태에서 보이는 한 줄 요약
    $(".fc-brief", card).innerHTML = `<b>${fmt(last.value)}명</b><span class="fc-sep">·</span>${md(first.date)} 대비 ${delta(first.value, last.value)}<span class="fc-sep">·</span>이번 달 ${delta(thisM[0].value, last.value)}`;
    // 펼침 상태 기억 (브라우저별, 실패해도 기본값=접힘)
    let open = false;
    try { open = localStorage.getItem("followCardOpen") === "1"; } catch (_) {}
    card.open = open;
    card.ontoggle = () => {
      try { localStorage.setItem("followCardOpen", card.open ? "1" : "0"); } catch (_) {}
      if (card.open) charts[`${cfg.key}-follow`]?.resize();
    };
    $(".fc-stats", card).innerHTML = `
      <div class="fc-now">${fmt(last.value)}<span>명</span></div>
      <div class="fc-sub">${md(last.date)} 기준</div>
      <dl class="fc-list">
        <div><dt>${md(first.date)} 대비</dt><dd>${delta(first.value, last.value)}</dd></div>
        <div><dt>이번 달 (${md(thisM[0].date)}~)</dt><dd>${delta(thisM[0].value, last.value)}</dd></div>
        <div><dt>기간 최고</dt><dd>${fmt(peak.value)}명 <span class="hint">${md(peak.date)}</span></dd></div>
        ${f.baseline ? `<div><dt>시작일 기준값</dt><dd>${fmt(f.baseline)}명</dd></div>` : ""}
      </dl>`;
    $(".fc-rows", card).innerHTML = months.map((m) => {
      const a = byM[m][0], b = byM[m].at(-1), d = b.value - a.value;
      return `<tr><td>${monthLabel(m)}</td><td class="num">${fmt(a.value)} <span class="hint">${md(a.date)}</span></td><td class="num">${fmt(b.value)} <span class="hint">${md(b.date)}</span></td>
        <td class="num ${d >= 0 ? "delta-up" : "delta-down"}">${signed(d)}</td><td class="num ${d >= 0 ? "delta-up" : "delta-down"}">${pct((d / a.value) * 100)}</td></tr>`;
    }).join("");
    chart(`${cfg.key}-follow`, $(".ch-follow-chart", card), {
      type: "line",
      data: { labels: pts.map((p) => md(p.date)),
        datasets: [{ label: "팔로워", data: pts.map((p) => p.value), borderColor: css(`--${cfg.color}`), backgroundColor: css(`--${cfg.color}`),
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.25 }] },
      options: {
        scales: { y: { ticks: { callback: (v) => fmt(v) } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` 팔로워 ${fmt(c.parsed.y)}명` } } },
      },
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

  /* ⑤ 광고 현황 (두 채널 통합) */
  let adsFilter = "all";
  function renderAdsOverview() {
    const all = CFG.channels.flatMap((cfg) => (M.channels[cfg.key].ads || []).map((a) => ({ ...a, ch: cfg })));
    const conf = all.filter((a) => a.confirmed === "확정").length;
    const k = (label, value, foot) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="foot">${foot}</div></div>`;
    $("#ads-kpis").innerHTML =
      k("전체 문의", `${fmt(all.length)}건`, CFG.channels.map((c) => `${esc(c.name)} ${(M.channels[c.key].ads || []).length}건`).join(" · ")) +
      k("진행 확정", `${fmt(conf)}건`, all.length ? `확정률 ${fmt1((conf / all.length) * 100)}%` : "") +
      k("미확정", `${fmt(all.filter((a) => a.confirmed === "미확정").length)}건`, "단가 전달 · 협의 중 포함") +
      k("검토 중", `${fmt(all.filter((a) => a.confirmed !== "확정" && a.confirmed !== "미확정").length)}건`, "확정 여부 미입력");
    const f = $("#ads-filter");
    f.innerHTML = [["all", "전체"], ...CFG.channels.map((c) => [c.key, c.name])]
      .map(([v, l]) => `<button type="button" data-v="${v}" aria-selected="${adsFilter === v}">${esc(l)}</button>`).join("");
    f.querySelectorAll("button").forEach((b) => (b.onclick = () => { adsFilter = b.dataset.v; renderAdsOverview(); }));
    const list = adsFilter === "all" ? all : all.filter((a) => a.ch.key === adsFilter);
    $("#ads-rows").innerHTML = list.length ? list.map((a) => `<tr>
      <td><span class="ch-tag"><i class="dot ${a.ch.color}"></i>${esc(a.ch.name)}</span></td>
      <td class="wrap-cell"><b>${esc(a.brand)}</b></td>
      <td class="wrap-cell">${[a.category, a.product].filter(Boolean).map(esc).join(" · ") || "-"}</td>
      <td>${esc(a.form) || "-"}</td><td>${esc(a.route) || "-"}</td><td>${esc(a.requested) || "-"}</td>
      <td>${a.status ? `<span class="badge">${esc(a.status)}</span>` : "-"}</td>
      <td><span class="badge ${a.confirmed === "확정" ? "good" : a.confirmed === "미확정" ? "" : "warn"}">${a.confirmed === "확정" ? "✓ " : a.confirmed === "미확정" ? "○ " : "… "}${esc(a.confirmed)}</span></td>
    </tr>`).join("") : `<tr><td colspan="8" class="hint">등록된 문의가 없어요.</td></tr>`;
  }

  /* ⑥ 채널별 전체 업로드 현황 */
  const up = { q: "", fmt: "all", hot: false, sort: "date", dir: "desc", limit: 50, key: null };
  // 인기 기준 (config.js에 highlight: { likes: 5000, shares: 50 } 을 넣으면 그 값으로 바뀜)
  const HL = { likes: CFG.highlight?.likes ?? 5000, shares: CFG.highlight?.shares ?? 50 };
  const hotLikes = (p) => p.likes >= HL.likes;      // 좋아요 5,000 이상
  const hotShares = (p) => p.shares > HL.shares;    // 공유 50 초과
  const isHot = (p) => hotLikes(p) || hotShares(p);
  const UP_COLS = [
    ["date", "날짜", false], ["format", "포맷", false], ["title", "콘텐츠명", false],
    ["views", "조회수", true], ["reach", "도달", true], ["likes", "좋아요", true],
    ["comments", "댓글", true], ["saves", "저장", true], ["shares", "공유", true],
  ];
  // 포맷 → 색상 클래스 ('광고'·'기획'이 들어간 포맷을 먼저 구분)
  const FMT_CLASS = [["광고", "ad"], ["기획", "plan"], ["릴스", "reels"], ["캐러셀", "carousel"], ["단일", "single"]];
  const fmtClass = (f) => (FMT_CLASS.find(([k]) => String(f).includes(k)) || [, "etc"])[1];
  const fmtBadge = (f) => `<span class="fmt fmt-${fmtClass(f)}">${esc(f)}</span>`;
  const dash = (v) => (v ? fmt(v) : '<span class="hint" title="집계 전">-</span>');

  function renderUploads() {
    const key = document.body.dataset.view;
    const cfg = CFG.channels.find((c) => c.key === key);
    if (!cfg || document.body.dataset.sub !== "uploads") return;
    if (up.key !== key) Object.assign(up, { q: "", fmt: "all", hot: false, sort: "date", dir: "desc", limit: 50, key });
    const c = M.channels[key].content;
    $("#h-uploads").textContent = `${cfg.name} 전체 업로드 현황`;
    if (!c) { $("#up-kpis").innerHTML = `<p class="hint">콘텐츠 데이터를 불러오지 못했어요.</p>`; $("#up-month").innerHTML = ""; $("#up-rows").innerHTML = ""; return; }
    const posts = period === "all" ? c.posts : c.posts.filter((p) => p.month === period);
    $("#up-period").textContent = period === "all" ? `${CFG.year % 100}년 전체` : monthLabel(period);

    // KPI
    const days = [...new Set(posts.map((p) => p.date))].sort();
    const fmts = {}; posts.forEach((p) => (fmts[p.format] = (fmts[p.format] || 0) + 1));
    const fmtText = Object.entries(fmts).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${esc(f)} ${n}`).join(" · ");
    const last = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const k = (label, value, foot) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="foot">${foot}</div></div>`;
    $("#up-kpis").innerHTML =
      k("총 업로드", `${fmt(posts.length)}건`, fmtText || "-") +
      k("업로드한 날", `${fmt(days.length)}일`, days.length ? `${days[0]} ~ ${days.at(-1)}` : "-") +
      k("하루 평균", `${days.length ? fmt1(posts.length / days.length) : 0}건`, "업로드한 날 기준") +
      k("최근 업로드", last ? last.date.slice(5).replace("-", "/") : "-", last ? esc(last.title) : "-");

    // 월별 표
    const fmtNames = Object.keys(fmts).sort((a, b) => fmts[b] - fmts[a]);
    $("#up-month-head").innerHTML = `<tr><th>월</th><th class="num">게시물</th>${fmtNames.map((f) => `<th class="num">${fmtBadge(f)}</th>`).join("")}<th class="num">조회수</th><th class="num">평균 조회수</th><th class="num">좋아요</th><th class="num">저장</th><th class="num">공유</th></tr>`;
    const months = P.byMonth(posts);
    const row = (label, list, m, cls = "") => `<tr class="${cls}"><td>${label}</td><td class="num">${fmt(m.count)}</td>${fmtNames.map((f) => `<td class="num">${fmt(list.filter((p) => p.format === f).length)}</td>`).join("")}
      <td class="num">${fmt(m.views)}</td><td class="num">${fmt(m.count ? m.views / m.count : 0)}</td><td class="num">${fmt(m.likes)}</td><td class="num">${fmt(m.saves)}</td><td class="num">${fmt(m.shares)}</td></tr>`;
    $("#up-month").innerHTML = months.map((m) => row(monthLabel(m.month), posts.filter((p) => p.month === m.month), m)).join("") +
      (months.length > 1 ? row("합계", posts, P.aggregate(posts), "total") : "");

    // 목록 필터
    const sel = $("#up-format");
    sel.innerHTML = `<option value="all">전체 포맷</option>` + fmtNames.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("");
    sel.value = fmtNames.includes(up.fmt) ? up.fmt : "all";
    $("#up-search").value = up.q;
    renderUploadList(posts);
  }

  function renderUploadList(posts) {
    if (!posts) {
      const c = M.channels[up.key]?.content; if (!c) return;
      posts = period === "all" ? c.posts : c.posts.filter((p) => p.month === period);
    }
    const q = up.q.trim().toLowerCase();
    let list = posts.filter((p) => (up.fmt === "all" || p.format === up.fmt) && (!q || p.title.toLowerCase().includes(q)) && (!up.hot || isHot(p)));
    const hotTotal = posts.filter(isHot).length;
    const dir = up.dir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      const x = a[up.sort], y = b[up.sort];
      const r = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "ko");
      return r !== 0 ? r * dir : a.row - b.row;   // 같은 날짜는 시트 순서대로
    });
    $("#up-head").innerHTML = `<tr>${UP_COLS.map(([k, l, n]) => `<th class="sortable ${n ? "num" : ""}" data-k="${k}" ${up.sort === k ? `aria-sort="${up.dir === "asc" ? "ascending" : "descending"}"` : ""}>${l}${up.sort === k ? (up.dir === "asc" ? " ▲" : " ▼") : ""}</th>`).join("")}</tr>`;
    $("#up-head").querySelectorAll("th").forEach((th) => (th.onclick = () => {
      const k = th.dataset.k;
      if (up.sort === k) up.dir = up.dir === "asc" ? "desc" : "asc";
      else { up.sort = k; up.dir = ["title", "format"].includes(k) ? "asc" : "desc"; }
      renderUploadList();
    }));
    const shown = list.slice(0, up.limit);
    let prev = null;
    $("#up-rows").innerHTML = shown.map((p) => {
      const newDay = up.sort === "date" && prev !== null && prev !== p.date; prev = p.date;
      const hot = isHot(p);
      const why = [hotLikes(p) && `좋아요 ${fmt(HL.likes)} 이상`, hotShares(p) && `공유 ${fmt(HL.shares)} 초과`].filter(Boolean).join(" · ");
      return `<tr class="${newDay ? "new-day" : ""} ${hot ? "hot" : ""}">
        <td>${p.date.slice(2).replace(/-/g, ".")}</td><td>${fmtBadge(p.format)}</td>
        <td class="t-title" ${hot ? `title="인기 콘텐츠: ${why}"` : ""}>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</td>
        <td class="num">${dash(p.views)}</td><td class="num">${dash(p.reach)}</td><td class="num ${hotLikes(p) ? "hot-cell" : ""}">${dash(p.likes)}</td>
        <td class="num">${dash(p.comments)}</td><td class="num">${dash(p.saves)}</td><td class="num ${hotShares(p) ? "hot-cell" : ""}">${dash(p.shares)}</td></tr>`;
    }).join("") || `<tr><td colspan="9" class="hint">조건에 맞는 콘텐츠가 없어요.</td></tr>`;
    $("#up-count").textContent = `· ${fmt(list.length)}건 중 ${fmt(shown.length)}건 표시 · 인기 ${fmt(hotTotal)}건`;
    $("#hot-rule").textContent = `= 좋아요 ${fmt(HL.likes)} 이상 또는 공유 ${fmt(HL.shares)} 초과`;
    $("#up-hot").checked = up.hot;
    const more = $("#up-more");
    more.hidden = list.length <= up.limit;
    more.textContent = `${Math.min(50, list.length - up.limit)}개 더 보기`;
  }
  $("#up-search").addEventListener("input", (e) => { up.q = e.target.value; up.limit = 50; renderUploadList(); });
  $("#up-format").addEventListener("change", (e) => { up.fmt = e.target.value; up.limit = 50; renderUploadList(); });
  $("#up-hot").addEventListener("change", (e) => { up.hot = e.target.checked; up.limit = 50; renderUploadList(); });
  $("#up-more").addEventListener("click", () => { up.limit += 50; renderUploadList(); });

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
  $("#period").addEventListener("change", (e) => { period = e.target.value; renderChannels(); up.limit = 50; renderUploads(); });
  $("#refresh").addEventListener("click", loadAll);

  /* ---------- 보기 탭 (주소 끝 #overview, #followers, #revenue, #kikiki, #gugu) ---------- */
  const VIEWS = ["overview", ...CFG.channels.map((c) => c.key), "revenue", "ads"];
  let dataReady = false;
  function applyView() {
    const [h, subRaw] = location.hash.slice(1).split("/");   // 예: #kikiki/uploads
    const view = VIEWS.includes(h) ? h : "overview";
    const isCh = CFG.channels.some((c) => c.key === view);
    document.body.dataset.view = view;
    document.body.dataset.sub = isCh && subRaw === "uploads" ? "uploads" : "summary";
    if (isCh) {
      const sub = document.body.dataset.sub;
      $("#channel-subnav").innerHTML = `<a href="#${view}" ${sub === "summary" ? 'aria-current="page"' : ""}>요약</a><a href="#${view}/uploads" ${sub === "uploads" ? 'aria-current="page"' : ""}>전체 업로드 현황</a>`;
    }
    document.querySelectorAll("#view-tabs a").forEach((a) => {
      if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (dataReady) render();                       // 보이게 된 차트를 올바른 크기로 다시 그림
  }
  window.addEventListener("hashchange", () => { applyView(); window.scrollTo({ top: 0 }); });
  // 새로 들어올 때는 항상 '전체 보기'로 시작 (새로고침할 때만 보던 탭 유지)
  const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
  if (!(nav && nav.type === "reload") && location.hash) history.replaceState(null, "", location.pathname + location.search);
  applyView();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  // 잠금이 풀린 뒤에만 데이터를 불러옴 (lock.js가 호출)
  let started = false;
  window.startDashboard = () => {
    if (started) return;
    started = true;
    loadAll();
    if (CFG.autoRefreshMinutes > 0) setInterval(() => { if (!document.hidden) loadAll(); }, CFG.autoRefreshMinutes * 60000);
  };
})();
