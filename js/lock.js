/* =========================================================
 * lock.js — 비밀번호 잠금 화면
 *  - 비밀번호 원문은 저장하지 않고, PBKDF2-SHA256으로 만든 확인값만 비교합니다.
 *  - 비밀번호를 바꾸려면 새 salt/check 값이 필요합니다(직접 수정하지 마세요).
 *  - 정적 사이트의 화면 잠금이라 '가림막' 역할입니다. (README 참고)
 * ========================================================= */
(function () {
  "use strict";
  const LOCK = { salt: "8a3a7fcab8dab2989aa7292359834076", iterations: 210000, check: "5b71e0055e7ba2c2d09ecca1a3e9c2dc6c2ed6d6cb6d2ecc9b5b2a84e2e9c3b3" };
  const KEY = "dashboardUnlock";
  const $ = (s) => document.querySelector(s);
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

  async function derive(pw) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(LOCK.salt), iterations: LOCK.iterations }, base, 256);
    return hex(bits);
  }
  const read = (store) => { try { return store.getItem(KEY); } catch (_) { return null; } };
  const write = (store, v) => { try { v == null ? store.removeItem(KEY) : store.setItem(KEY, v); } catch (_) {} };

  function unlock() {
    document.body.classList.remove("locked");
    $("#lock").hidden = true;
    window.startDashboard && window.startDashboard();
  }

  // 이미 이 브라우저에서 잠금을 풀었으면 바로 열기
  if (read(sessionStorage) === LOCK.check || read(localStorage) === LOCK.check) { unlock(); }
  else {
    document.body.classList.add("locked");
    $("#lock").hidden = false;
    setTimeout(() => $("#lock-pw").focus(), 50);
  }

  let fails = 0;
  $("#lock-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#lock-btn"), msg = $("#lock-msg"), pw = $("#lock-pw").value;
    if (!pw) { msg.textContent = "비밀번호를 입력해 주세요."; return; }
    if (!window.crypto || !crypto.subtle) { msg.textContent = "이 주소(http)에서는 잠금을 풀 수 없어요. https 주소로 접속해 주세요."; return; }
    btn.disabled = true; msg.textContent = "확인 중…";
    const v = await derive(pw);
    if (v === LOCK.check) {
      write(sessionStorage, v);
      if ($("#lock-remember").checked) write(localStorage, v);
      msg.textContent = ""; unlock();
    } else {
      fails++;
      const wait = Math.min(30, fails >= 3 ? (fails - 2) * 5 : 0);   // 3번 이상 틀리면 잠시 대기
      $("#lock-pw").value = ""; $("#lock-pw").classList.add("shake");
      setTimeout(() => $("#lock-pw").classList.remove("shake"), 400);
      if (wait) {
        let left = wait;
        const tick = () => { msg.textContent = `비밀번호가 맞지 않아요. ${left}초 후 다시 시도해 주세요.`; if (left-- > 0) setTimeout(tick, 1000); else { btn.disabled = false; msg.textContent = "다시 입력해 주세요."; $("#lock-pw").focus(); } };
        tick(); return;
      }
      msg.textContent = "비밀번호가 맞지 않아요.";
      $("#lock-pw").focus();
    }
    btn.disabled = false;
  });
})();
