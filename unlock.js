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
 *           data-hash="043066daf2109523a7490d4bfad4766da5719950a2b5f96d192fc0537e84f32a"></script>
 *
 *   data-api        … Apps Script のウェブアプリURL（必須）
 *   data-room       … クラスの名前（省略時 main）
 *   data-min-stage  … この段階以上で開く（1=担当の変数だけ／2=すべて。省略時 1）
 *   data-pw-minutes … パスワードで開いたとき、何分で自動的に閉じるか（省略時 4）
 *   data-hash       … パスワードのSHA-256（省略するとパスワード欄なし）。上は「152」
 *   data-interval   … 確認の間隔ミリ秒（省略時 4000）
 *
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
  var api = sc.getAttribute('data-api') || '';
  var room = sc.getAttribute('data-room') || 'main';
  var minStage = parseInt(sc.getAttribute('data-min-stage') || '1', 10);
  var hash = (sc.getAttribute('data-hash') || '').toLowerCase();
  var every = parseInt(sc.getAttribute('data-interval') || '4000', 10);
  var pwMin = parseFloat(sc.getAttribute('data-pw-minutes') || '4');

  var by = '';          // '' | 'teacher' | 'password'
  var endAt = 0, total = 0;
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
    sub = el('div', 'font-size:18px;color:#4F5A6B;margin-bottom:16px;', '先生の合図があるまで、動かせません。');
    card.appendChild(title); card.appendChild(sub);
    var row = el('div', 'display:flex;align-items:center;justify-content:center;gap:8px;font-size:16px;color:#4F5A6B;');
    dot = el('span', 'display:inline-block;width:12px;height:12px;border-radius:50%;background:#B8B2A0;');
    note = el('span', '', '接続しています…');
    row.appendChild(dot); row.appendChild(note);
    card.appendChild(row);
    if (hash && window.crypto && crypto.subtle) {
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
    if (pwAllowed === 0) { say('いまは、パスワードでは開けません。'); return; }
    sha(pw.value.trim()).then(function (h) {
      if (h === hash) { pw.value = ''; say(''); open('password', pwMin * 60); }
      else { pw.value = ''; say('ちがいます。'); }
    });
  }
  function say(t) { if (msg) msg.textContent = t; }

  function fire(name) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: { by: by, minStage: minStage } })); } catch (e) {}
  }

  function open(who, secs) {
    build();
    by = who;
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
    by = ''; endAt = 0;
    bar.style.display = 'none';
    title.textContent = reason === 'time' ? '時間です' : 'ロック中';
    sub.textContent = reason === 'time' ? 'シミュレーターは、ここまでです。' : '先生の合図があるまで、動かせません。';
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
        if (by === 'teacher' && d.left !== null && d.left !== undefined) {
          endAt = Date.now() + d.left * 1000;           // サーバーの残り時間に合わせる
        } else if (by !== 'teacher') {
          open('teacher', (d.left === null || d.left === undefined) ? 0 : d.left);
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
