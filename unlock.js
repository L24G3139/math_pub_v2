/*
 * unlock.js — 生徒側のシミュレーターを、先生の合図で解除し、時間で自動的にロックに戻す
 *
 * シミュレーター（学習ポータルの、Desmos を入れたページ）に、次の1行を入れます。
 *
 *   <script src="unlock.js"
 *           data-api="https://script.google.com/macros/s/xxxx/exec"
 *           data-room="main"
 *           data-min-stage="1"
 *           data-pw-minutes="4"
 *           data-hash="a:ハッシュ,p:ハッシュ,q:ハッシュ"></script>
 *
 *   data-api        … Apps Script のウェブアプリURL（必須）
 *   data-room       … クラスの名前（省略時 main）
 *   data-min-stage  … この段階以上で開く（1=担当の変数だけ／2=すべて。省略時 1）
 *   data-pw-minutes … パスワードで開いたとき、何分で自動的に閉じるか（省略時 4）
 *   data-hash       … 担当ごとのパスワードのSHA-256（省略するとパスワード欄なし）。
 *                     パスワードを入れると、その担当（a/p/q）の変数だけ動かせる
 *   data-interval   … 確認の間隔ミリ秒（省略時 4000）
 *
 * ・ページ側は、window.simStage（0/1/2）と、simulator:unlock / simulator:stage / simulator:lock の
 *   イベントで、いまの段階を知ることができます（パスワードで開いたときは段階1）。
 * ・解除中は、画面の上に、時間がたつと満ちていく帯と「あと M:SS」が出ます。
 * ・時間がきたら、自動的に「時間です」のロック画面に戻ります。
 * ・パスワードは、先生が「パスワードで開く」を入にしている間だけ使えます。
 *   先生が切にすると、パスワードで開いていた画面も閉じます。
 * ・先生のサーバーに一度もつながらないときだけ、パスワードで開けます（通信が切れたとき用）。
 * ・ページは UTF-8 で保存してください。
 */
(function () {
  var sc = document.currentScript || document.querySelector('script[data-api]');
  if (!sc) return;
  window.simStage = 0;   // 読み込めた目印（ページ側が、unlock.js の新旧を見分ける）
  var api = sc.getAttribute('data-api') || '';
  var room = sc.getAttribute('data-room') || 'main';
  var minStage = parseInt(sc.getAttribute('data-min-stage') || '1', 10);
  // data-hash … "a:ハッシュ,p:ハッシュ,q:ハッシュ"（担当ごとのパスワード）。「ハッシュ」だけなら担当なし
  var hashes = {};
  (sc.getAttribute('data-hash') || '').toLowerCase().split(',').forEach(function (x) {
    x = x.trim(); if (!x) return;
    var i = x.indexOf(':');
    hashes[i < 0 ? x : x.slice(i + 1)] = i < 0 ? '' : x.slice(0, i);
  });
  var hasPw = Object.keys(hashes).length > 0;
  var pwRole = '';      // パスワードで開いたときの、担当（a / p / q）
  var every = parseInt(sc.getAttribute('data-interval') || '4000', 10);
  var pwMin = parseFloat(sc.getAttribute('data-pw-minutes') || '4');

  var by = '';          // '' | 'teacher' | 'password'
  var endAt = 0, total = 0, stage = 0;   // stage: 解除中の段階（0=ロック／1=担当の変数だけ／2=すべて）
  var pwAllowed = null; // null=まだ一度もつながっていない / 0 / 1
  var built = false, ov, title, sub, dot, note, pw, bar, fill, lab, msg;

  function el(tag, css, text) {
    var d = document.createElement(tag);
    if (css) d.style.cssText = css;
    if (text) d.textContent = text;
    return d;
  }
  var FONT = 'font-family:"Hiragino Sans","Noto Sans JP","Yu Gothic",Meiryo,sans-serif;';

  function build() {
    if (built) return;
    built = true;
    // 時間の帯（解除中だけ表示）
    bar = el('div', 'position:fixed;left:0;top:0;right:0;height:34px;z-index:2147483646;pointer-events:none;display:none;background:rgba(221,214,194,.92);' + FONT);
    fill = el('div', 'position:absolute;left:0;top:0;bottom:0;width:0;background:#2B3A55;');
    lab = el('div', 'position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#172033;mix-blend-mode:normal;text-shadow:0 0 4px #F7F4EC,0 0 4px #F7F4EC;');
    bar.appendChild(fill); bar.appendChild(lab);
    document.body.appendChild(bar);
    // ロック画面
    ov = el('div', 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(247,244,236,.97);color:#172033;transition:opacity .45s;' + FONT);
    var card = el('div', 'background:#FFFDF8;border:2px solid #D8D3C4;border-radius:24px;padding:32px 40px;max-width:460px;width:80%;text-align:center;box-sizing:border-box;');
    card.appendChild(el('div', 'font-size:56px;line-height:1;', '🔒'));
    title = el('div', 'font-size:28px;font-weight:800;margin:12px 0 6px;', 'ロック中');
    sub = el('div', 'font-size:18px;color:#4F5A6B;margin-bottom:16px;', '先生の合図、または、自分の担当のパスワードで開きます。');
    card.appendChild(title); card.appendChild(sub);
    var row = el('div', 'display:flex;align-items:center;justify-content:center;gap:8px;font-size:16px;color:#4F5A6B;');
    dot = el('span', 'display:inline-block;width:12px;height:12px;border-radius:50%;background:#B8B2A0;');
    note = el('span', '', '接続しています…');
    row.appendChild(dot); row.appendChild(note);
    card.appendChild(row);
    if (hasPw && window.crypto && crypto.subtle) {
      var f = el('div', 'display:flex;gap:8px;justify-content:center;margin-top:20px;');
      pw = el('input', 'font-size:20px;padding:8px 12px;border:2px solid #D8D3C4;border-radius:12px;width:150px;text-align:center;');
      pw.type = 'password'; pw.placeholder = 'パスワード'; pw.setAttribute('inputmode', 'numeric'); pw.autocomplete = 'off';
      var b = el('button', 'font-size:20px;font-weight:700;padding:8px 20px;border:0;border-radius:12px;background:#2B3A55;color:#FFFDF8;cursor:pointer;', '開く');
      b.type = 'button';
      b.onclick = tryPw;
      pw.onkeydown = function (ev) { if (ev.key === 'Enter') tryPw(); };
      f.appendChild(pw); f.appendChild(b); card.appendChild(f);
      msg = el('div', 'min-height:22px;margin-top:8px;font-size:15px;color:#A8430A;');
      card.appendChild(msg);
    }
    ov.appendChild(card);
    document.body.appendChild(ov);
  }

  function sha(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }

  function tryPw() {
    if (pwAllowed === 0) { say('いまは、パスワードでは開けません。先生に聞いてください。'); return; }
    sha(pw.value.trim()).then(function (h) {
      if (Object.prototype.hasOwnProperty.call(hashes, h)) { pw.value = ''; say(''); open('password', pwMin * 60, 1, hashes[h]); }
      else { pw.value = ''; say('ちがいます。'); }
    });
  }
  function say(t) { if (msg) msg.textContent = t; }

  function fire(name) {
    window.simStage = stage;   // ページは、これを見て、動かせるものを決める
    window.simBy = by;         // 'teacher'（先生の合図）／'password'（パスワード）
    window.simPwRole = pwRole; // パスワードで開いたときの担当
    try { window.dispatchEvent(new CustomEvent(name, { detail: { by: by, stage: stage, role: pwRole, minStage: minStage } })); } catch (e) {}
  }

  function open(who, secs, stg, role) {
    build();
    by = who;
    stage = stg || 1;
    pwRole = who === 'password' ? (role || '') : '';
    total = secs ? secs * 1000 : 0;
    endAt = secs ? Date.now() + total : 0;
    ov.style.opacity = '0';
    setTimeout(function () { if (by) ov.style.display = 'none'; }, 460);
    bar.style.display = endAt ? 'block' : 'none';
    tick();
    fire('simulator:unlock');
  }
  function lock(reason) {
    build();
    by = ''; endAt = 0; stage = 0; pwRole = '';
    bar.style.display = 'none';
    title.textContent = reason === 'time' ? '時間です' : 'ロック中';
    sub.textContent = reason === 'time' ? 'シミュレーターは、ここまでです。' : '先生の合図、または、自分の担当のパスワードで開きます。';
    ov.style.display = 'flex';
    requestAnimationFrame(function () { ov.style.opacity = '1'; });
    fire('simulator:lock');
  }

  function tick() {
    if (!endAt) return;
    var left = endAt - Date.now();
    if (left <= 0) { lock('time'); return; }
    var p = Math.min(1, 1 - left / total);
    fill.style.width = (p * 100) + '%';
    var s = Math.ceil(left / 1000);
    lab.textContent = 'あと ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function status(isOnline, text) {
    if (!built) return;
    dot.style.background = isOnline ? '#1F8A84' : '#A8430A';
    note.textContent = text;
  }

  function poll() {
    if (!api) { status(false, 'API の設定がありません'); return; }
    var url = api + (api.indexOf('?') < 0 ? '?' : '&') + 'action=get&room=' + encodeURIComponent(room) + '&_=' + Date.now();
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error('bad');
      pwAllowed = d.pw ? 1 : 0;
      status(true, '先生の合図を待っています');
      if (d.stage >= minStage) {
        var hasLeft = d.left !== null && d.left !== undefined;
        if (by === 'teacher') {
          if (hasLeft) endAt = Date.now() + d.left * 1000;   // サーバーの残り時間に合わせる
          if (d.stage !== stage) { stage = d.stage; fire('simulator:stage'); }
        } else {
          open('teacher', hasLeft ? d.left : 0, d.stage);
        }
      } else if (by === 'teacher') {
        lock('lock');
      } else if (by === 'password' && !pwAllowed) {
        lock('lock');                                    // 先生がパスワードを切にした
      }
    }).catch(function () {
      status(false, pwAllowed === null ? '通信できません。パスワードで開けます' : '通信できません');
    });
  }

  function start() {
    build();
    tick();
    setInterval(tick, 250);
    poll();
    setInterval(poll, every);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
