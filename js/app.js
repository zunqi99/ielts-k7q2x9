/* IELTS practice UI. All progress stays in localStorage. No network calls except local files. */
(function () {
  "use strict";
  var E = window.IeltsEngine;
  var KEY = "ielts-james-v1";
  var app = document.getElementById("app");
  var pop = document.getElementById("pop");

  var WORDS = [];
  var UNITS = [];
  var GRAMMAR = [];
  var ARTICLES = [];
  var GLOSS = {};
  var wordById = {};
  var gById = {};
  var state = null;
  var tab = "quiz";
  var session = null;
  var wordPane = "wrong";
  var reader = { view: "lib" };

  var TTS = "speechSynthesis" in window;
  var voice = null;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var reading = false;
  var recog = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1 && parsed.cards && parsed.examDate) return parsed;
      }
    } catch (e) {}
    return E.initState();
  }

  function ensureQuiz() {
    var today = E.todayStr();
    var before = state.streak;
    E.touchStreak(state, today);
    var dirty = state.streak !== before;
    if (!state.quiz || state.quiz.date !== today) {
      state.quiz = E.generateQuiz(state, WORDS, GRAMMAR, today);
      state.quiz.picks = [];
      dirty = true;
      session = null;
    }
    if (!state.quiz.picks) state.quiz.picks = [];
    if (!state.quiz.graded) state.quiz.graded = {};
    if (!state.saved) state.saved = [];
    if (!state.learned) state.learned = {};
    if (!state.introduced) state.introduced = [];
    if (dirty) save();
  }

  function pickVoice() {
    if (!TTS) return;
    try {
      var list = speechSynthesis.getVoices() || [];
      voice = list.filter(function (v) { return v.lang === "en-GB"; })[0]
        || list.filter(function (v) { return /en[-_]GB/i.test(v.lang); })[0]
        || list.filter(function (v) { return /en[-_]US/i.test(v.lang); })[0]
        || list.filter(function (v) { return /^en/i.test(v.lang); })[0]
        || null;
    } catch (e) {}
  }
  if (TTS) {
    pickVoice();
    try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {}
  }

  function say(text, onend) {
    if (!TTS || !text) { if (onend) onend(); return; }
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = voice ? voice.lang : "en-GB";
      if (voice) u.voice = voice;
      u.rate = state && state.slow ? 0.65 : 0.95;
      if (onend) u.onend = function () { onend(); };
      u.onerror = function () { if (onend) onend(); };
      speechSynthesis.speak(u);
    } catch (e) { if (onend) onend(); }
  }

  function stopSpeech() {
    reading = false;
    try { if (TTS) speechSynthesis.cancel(); } catch (e) {}
    if (recog) { try { recog.stop(); } catch (e) {} recog = null; }
    document.querySelectorAll(".s.cur").forEach(function (el) { el.classList.remove("cur"); });
  }

  function spk(text) {
    if (!TTS || !text) return "";
    return '<button type="button" class="spk" data-say="' + esc(text) + '" aria-label="播放發音">🔊</button>';
  }

  var norm = function (s) { return String(s || "").toLowerCase().replace(/[^a-z ]/g, "").trim(); };
  function lev(a, b) {
    var d = [];
    for (var i = 0; i <= a.length; i++) {
      d[i] = [i];
    }
    for (var j = 1; j <= b.length; j++) d[0][j] = j;
    for (var ii = 1; ii <= a.length; ii++) {
      for (var jj = 1; jj <= b.length; jj++) {
        d[ii][jj] = Math.min(d[ii - 1][jj] + 1, d[ii][jj - 1] + 1, d[ii - 1][jj - 1] + (a[ii - 1] === b[jj - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }
  function matchSaid(alts, target) {
    var t = norm(target);
    return alts.some(function (a) {
      a = norm(a);
      if (!a) return false;
      if (a === t) return true;
      return a.split(" ").some(function (w) { return w === t || (t.length > 5 && lev(w, t) <= 1); });
    });
  }
  var micNote = '<div class="note">此瀏覽器不支援語音辨識。請改用 Chrome（Android）或 Safari（iOS）練習口說。</div>';
  function micBtn(w) {
    if (!SR || !w) return "";
    return '<button type="button" class="spk mic" data-mic="' + esc(w) + '" aria-label="錄音">🎤</button><span class="res"></span>';
  }
  function listen(target, btn) {
    if (!SR) return;
    var out = btn.nextElementSibling;
    var r;
    try { r = new SR(); } catch (e) { return; }
    r.lang = "en-GB";
    r.interimResults = false;
    r.maxAlternatives = 5;
    btn.classList.add("on");
    if (out) out.innerHTML = " 請說…";
    r.onresult = function (ev) {
      var alts = [];
      try { alts = Array.prototype.slice.call(ev.results[0]).map(function (x) { return x.transcript; }); } catch (e) {}
      var ok = matchSaid(alts, target);
      if (out) {
        out.innerHTML = ok
          ? ' <span class="pass">通過了！</span>'
          : ' <span class="fail">再試一次</span> <span class="note">（聽到：' + esc(alts[0] || "") + "）</span>";
      }
    };
    r.onerror = function (ev) {
      if (out) out.innerHTML = ' <span class="note">' + (ev.error === "not-allowed" ? "請允許使用麥克風" : "沒聽清楚，再試一次") + "</span>";
    };
    r.onend = function () { btn.classList.remove("on"); };
    try { r.start(); } catch (e) { btn.classList.remove("on"); }
  }

  function togHtml() {
    if (!TTS) return '<div class="note">此瀏覽器不支援發音功能</div>';
    return '<label class="tog"><input type="checkbox" id="slow" ' + (state.slow ? "checked" : "") + "> 🐢 慢速發音</label>";
  }
  function bindTog() {
    var c = document.getElementById("slow");
    if (!c) return;
    c.onchange = function () { state.slow = c.checked; save(); };
  }

  function learnedCount() {
    return Object.keys(state.learned || {}).length;
  }

  function topBar(p) {
    var today = E.todayStr();
    var info = E.examInfo(state.examDate, new Date());
    var streak = E.effectiveStreak(state, today);
    return '<div class="top"><span class="fire">🔥 ' + streak + '</span><span class="cd">📅 ' + esc(info.label) + '</span><span class="xp">⭐ ' + state.xp + " XP · 📖 " + learnedCount() + '</span></div><div class="bar"><i style="width:' + Math.max(0, Math.min(100, p)) + '%"></i></div>';
  }

  function setTabs() {
    document.querySelectorAll("#tabs button").forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }

  function render() {
    app.onclick = null;
    ensureQuiz();
    setTabs();
    if (tab === "quiz") renderQuiz();
    else if (tab === "reader") renderReader();
    else if (tab === "words") renderWords();
    else renderStats();
  }

  function renderQuiz() {
    if (session) return renderQuestion(session, false);
    var q = state.quiz;
    if (q.phase === "quiz") return renderQuestion(q, true);
    if (q.phase === "result") return renderResult(q, true);
    if (q.phase === "speak") return renderSpeak(q);
    renderHome(q);
  }

  function renderHome(q) {
    var today = E.todayStr();
    var path = E.pathModel(state, WORDS, UNITS);
    var unit = path.groups[path.currentUnit];
    var title = unit ? (unit.title + " · 第 " + (path.currentLesson + 1) + " 課") : "今日練習";
    var hist = state.history[today];
    var completed = !!(hist && hist.completed);
    var inProgress = !q.done && (q.cursor > 0 || (q.picks || []).some(function (x) { return typeof x === "number"; }));
    var label = inProgress ? "繼續" : (completed ? "再練一次" : "開始");
    var h = topBar(completed ? 100 : 0);
    h += '<div class="card"><span class="tag">今日練習 ' + esc(today) + "</span><h1>" + esc(title) + "</h1>";
    h += '<div class="sub">10 題（約 7 題字彙、3 題文法）＋ 口說 · 目標 IELTS 6.5</div>';
    if (completed) h += '<div class="sub">今日最佳成績：' + hist.score + " / " + hist.total + "</div>";
    h += '<button type="button" class="btn" id="start">' + esc(label) + "</button>";
    h += '<button type="button" class="btn gray" id="speak">直接口說練習</button>';
    h += '<p class="note">題目依這台裝置的日期產生。錯題與新單字會排進之後的練習，紀錄只存在本機。</p></div>';
    h += '<div class="path">';
    path.groups.forEach(function (u, ui) {
      var locked = ui > path.currentUnit;
      var cls = locked ? "locked" : (u.complete ? "done" : "");
      h += '<div class="unit ' + cls + '"><h2>' + (locked ? "🔒 " : (u.complete ? "✓ " : "")) + esc(u.title) + "</h2>";
      h += '<div class="ug">文法：' + esc((u.grammar || []).join("、") || "—") + " · " + u.introduced + " / " + u.total + " 個字</div></div>";
      u.lessons.forEach(function (lesson, li) {
        var st = "";
        if (locked) st = "";
        else if (lesson.complete || ui < path.currentUnit) st = "done";
        else if (ui === path.currentUnit && li === path.currentLesson) st = "cur";
        else if (ui === path.currentUnit && li < path.currentLesson) st = "done";
        var icon = st === "done" ? "✓" : (st === "cur" ? "★" : "🔒");
        var off = [0, 46, 64, 46, 0, -46, -64, -46][li % 8];
        h += '<div class="node ' + st + '" style="transform:translateX(' + off + 'px)">' + icon + "</div>";
        if (st === "cur") h += '<div class="lbl">第 ' + (li + 1) + " 課 · " + lesson.done + " / " + lesson.total + "</div>";
      });
    });
    h += "</div>";
    app.innerHTML = h;
    document.getElementById("start").onclick = function () {
      if (!inProgress && completed) {
        q.cursor = 0;
        q.correct = 0;
        q.wrong = [];
        q.picks = [];
        q.replay = true;
        q.done = false;
      }
      q.phase = "quiz";
      save();
      render();
    };
    document.getElementById("speak").onclick = function () {
      q.phase = "speak";
      save();
      render();
    };
  }

  function renderQuestion(q, isDaily) {
    var item = q.items[q.cursor];
    if (!item) {
      q.phase = "result";
      q.done = true;
      if (isDaily) E.finishQuiz(state, q, E.todayStr());
      save();
      return renderResult(q, isDaily);
    }
    var picked = q.picks ? q.picks[q.cursor] : undefined;
    var answered = typeof picked === "number";
    var p = q.items.length ? (q.cursor / q.items.length) * 100 : 0;
    var vocab = item.type !== "grammar";
    var cloze = vocab && String(item.prompt).indexOf("______") !== -1;
    var h = topBar(p);
    h += '<div class="card"><span class="tag">' + (q.title ? esc(q.title) + " · " : "") + (vocab ? "字彙" : "文法") + " · 第 " + (q.cursor + 1) + " / " + q.items.length + " 題</span>";
    h += togHtml();
    if (vocab && !cloze) {
      h += '<div style="margin-top:8px;font-size:20px;font-weight:800">' + esc(item.word) + ' <span class="ipa">' + esc(item.ipa || "") + "</span>" + spk(item.word) + "</div>";
    }
    h += '<h2 style="margin-top:10px">' + esc(item.prompt) + "</h2>";
    h += item.choices.map(function (c, k) {
      var cls = "opt";
      if (answered) {
        if (k === item.answer) cls += " ok";
        else if (k === picked) cls += " bad";
      }
      return '<button type="button" class="' + cls + '" data-k="' + k + '">' + esc(c) + "</button>";
    }).join("");
    h += '<div id="fb">' + (answered ? feedbackHtml(item, picked === item.answer) : "") + "</div></div>";
    h += '<button type="button" class="btn" id="next" ' + (answered ? "" : "disabled") + ">" + (q.cursor === q.items.length - 1 ? "查看結果" : "下一題") + "</button>";
    h += '<button type="button" class="btn gray" id="back">' + (isDaily ? "回到路徑" : "結束複習") + "</button>";
    app.innerHTML = h;
    bindTog();
    if (!answered) {
      app.querySelectorAll(".opt").forEach(function (b) {
        b.onclick = function () { pick(q, isDaily, +b.dataset.k); };
      });
    }
    document.getElementById("next").onclick = function () { advance(q, isDaily); };
    document.getElementById("back").onclick = function () {
      if (isDaily) { q.phase = "home"; save(); }
      else session = null;
      render();
    };
    if (vocab && !cloze && !answered) setTimeout(function () { say(item.word); }, 280);
  }

  function feedbackHtml(item, ok) {
    var vocab = item.type !== "grammar";
    return '<div class="fb ' + (ok ? "ok" : "bad") + '"><b>' + (ok ? "答對了！" : "答錯了") + "</b><div>正確答案：<b>" + esc(item.choices[item.answer]) + "</b>" + (item.meaning ? " — " + esc(item.meaning) : "") + "</div>"
      + (vocab ? '<div style="margin-top:6px"><b>' + esc(item.word) + '</b> <span class="ipa">' + esc(item.ipa || "") + "</span>" + spk(item.word) + micBtn(item.word) + "</div>" + (SR ? "" : micNote) : "")
      + '<div class="ex">' + esc(item.example) + spk(item.example) + "</div></div>";
  }

  function pick(q, isDaily, k) {
    if (typeof q.picks[q.cursor] === "number") return;
    var item = q.items[q.cursor];
    q.picks[q.cursor] = k;
    var key = item.type + ":" + item.id;
    var skip = false;
    if (isDaily) skip = !!(q.replay || q.graded[key]);
    else skip = !q.srs || !!(q.graded && q.graded[key]);
    var ok = E.gradeQuestion(state, item, k, E.todayStr(), skip);
    if (!skip) {
      if (isDaily) q.graded[key] = true;
      else {
        q.graded = q.graded || {};
        q.graded[key] = true;
      }
    }
    if (ok) q.correct += 1;
    else q.wrong.push(item);
    save();
    renderQuestion(q, isDaily);
  }

  function advance(q, isDaily) {
    q.cursor += 1;
    if (q.cursor >= q.items.length) {
      q.phase = "result";
      q.done = true;
      if (isDaily) E.finishQuiz(state, q, E.todayStr());
      save();
      renderResult(q, isDaily);
      return;
    }
    save();
    renderQuestion(q, isDaily);
  }

  function renderResult(q, isDaily) {
    var h = topBar(100);
    h += '<div class="card"><h1 style="text-align:center">' + (q.title ? esc(q.title) + "完成" : (q.items.length === 10 ? "課程完成！" : "練習完成！")) + '</h1><div class="big">' + q.correct + " / " + q.items.length + "</div>";
    if (isDaily && state.history[q.date]) h += '<div class="sub" style="text-align:center">今日最佳 ' + state.history[q.date].score + " / " + state.history[q.date].total + " · 🔥 " + E.effectiveStreak(state, E.todayStr()) + " 天</div>";
    h += "</div>";
    if (q.wrong.length) {
      h += '<div class="card"><h2>需要再看的題目</h2>';
      q.wrong.forEach(function (item) {
        h += "<p><b>" + esc(item.word) + "</b> " + (item.ipa ? '<span class="ipa">' + esc(item.ipa) + "</span>" : "") + (item.type !== "grammar" ? spk(item.word) : "") + " — " + esc(item.meaning) + '<br><span class="ex">' + esc(item.example) + spk(item.example) + "</span></p>";
      });
      h += '</div><button type="button" class="btn" id="retry">只練錯題</button>';
    } else {
      h += '<div class="card">全部答對，太棒了！</div>';
    }
    if (isDaily) h += '<button type="button" class="btn" id="speak">口說練習</button>';
    h += '<button type="button" class="btn gray" id="back">' + (isDaily ? "回到路徑" : "回到單字本") + "</button>";
    app.innerHTML = h;
    var retry = document.getElementById("retry");
    if (retry) retry.onclick = function () {
      session = {
        title: "錯題複習",
        items: q.wrong.map(function (item) { return Object.assign({}, item); }),
        cursor: 0,
        correct: 0,
        wrong: [],
        picks: [],
        graded: {},
        done: false,
        phase: "quiz",
        practice: true,
        srs: false
      };
      render();
    };
    var sp = document.getElementById("speak");
    if (sp) sp.onclick = function () { q.phase = "speak"; save(); render(); };
    document.getElementById("back").onclick = function () {
      if (isDaily) { q.phase = "home"; save(); }
      else { session = null; tab = "words"; }
      render();
    };
  }

  function renderSpeak(q) {
    var ws = q.items.filter(function (item) { return item.type !== "grammar"; });
    var h = topBar(100);
    h += '<div class="card"><h1>口說練習</h1><div class="sub">先按 🔊 聽，再按 🎤 跟著說</div>' + togHtml() + (SR ? "" : micNote);
    ws.forEach(function (item) {
      h += '<p style="font-size:18px"><b>' + esc(item.word) + '</b> <span class="ipa">' + esc(item.ipa || "") + '</span><br><span class="note">' + esc(item.meaning) + "</span><br>" + spk(item.word) + micBtn(item.word) + "</p>";
    });
    h += '</div><button type="button" class="btn gray" id="back">回到路徑</button>';
    app.innerHTML = h;
    bindTog();
    document.getElementById("back").onclick = function () { q.phase = "home"; save(); render(); };
  }

  function glossOf(k) {
    var key = String(k || "").toLowerCase();
    if (GLOSS[key]) return { ipa: GLOSS[key][0], pos: GLOSS[key][1], zh: GLOSS[key][2] };
    var w = wordById[key];
    if (!w) {
      w = WORDS.filter(function (item) { return item.word.toLowerCase() === key; })[0];
    }
    if (w) return { ipa: String(w.ipa || "").replace(/\//g, ""), pos: w.pos, zh: w.zh };
    return null;
  }

  function splitSentences(text) {
    var parts = String(text || "").match(/[^.!?]+[.!?]+/g);
    if (!parts) return [String(text || "").trim()].filter(Boolean);
    return parts.map(function (s) { return s.trim(); });
  }

  function wrapWords(sentence) {
    var re = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
    var out = "";
    var last = 0;
    var m;
    while ((m = re.exec(sentence))) {
      out += esc(sentence.slice(last, m.index));
      var w = m[0];
      var k = w.toLowerCase().replace(/’/g, "'");
      if (glossOf(k)) {
        var saved = (state.saved || []).some(function (x) { return x.w === k; });
        out += '<span class="w' + (saved ? " saved" : "") + '" data-w="' + esc(k) + '">' + esc(w) + "</span>";
      } else out += esc(w);
      last = m.index + w.length;
    }
    out += esc(sentence.slice(last));
    return out;
  }

  function renderReader() {
    stopSpeech();
    hidePop();
    if (reader.view === "article") return openArticle(reader.index);
    var h = '<div class="top"><span>點讀英文</span><span style="color:#58cc02">⭐ ' + (state.saved || []).length + '</span><button type="button" class="btn gray sm" id="slowbtn" style="margin:0">' + (state.slow ? "🐢 慢速：開" : "🐢 慢速：關") + "</button></div>";
    h += "<h1>文章庫</h1><div class=\"sub\">六篇口說主題。點單字看音標、詞性與中文，點 ▶ 聽句子。每篇有三題 IELTS 口說。</div>";
    ARTICLES.forEach(function (a, i) {
      var n = String(a.text || "").split(/\s+/).filter(Boolean).length;
      h += '<div class="card art" data-i="' + i + '"><div class="ic">' + (a.icon || "📄") + '</div><div><h2>' + esc(a.title) + '</h2><div class="sub">' + esc(a.zh || "") + " · 約 " + n + " 字</div></div></div>";
    });
    app.innerHTML = h;
    var slow = document.getElementById("slowbtn");
    if (slow) slow.onclick = function () { state.slow = !state.slow; save(); renderReader(); };
    app.querySelectorAll(".art").forEach(function (el) {
      el.onclick = function () { reader.view = "article"; reader.index = +el.dataset.i; openArticle(reader.index); };
    });
  }

  function openArticle(i) {
    stopSpeech();
    var a = ARTICLES[i];
    if (!a) { reader.view = "lib"; return renderReader(); }
    reader.view = "article";
    reader.index = i;
    var ss = splitSentences(a.text);
    window.scrollTo(0, 0);
    var h = '<button type="button" class="btn gray sm" id="back">← 文章庫</button>';
    h += "<h1>" + (a.icon || "") + " " + esc(a.title) + "</h1><div class=\"sub\">" + esc(a.zh || "") + "</div>";
    h += '<div><button type="button" class="btn sm" id="all">朗讀全文</button><button type="button" class="btn gray sm" id="stop">停止</button></div>';
    h += '<div class="card txt">' + ss.map(function (s, j) {
      return '<span class="s" data-j="' + j + '"><button type="button" class="play" data-j="' + j + '" aria-label="播放句子">▶</button>' + wrapWords(s) + "</span> ";
    }).join("") + "</div>";
    h += "<h2>IELTS 口說練習</h2>";
    if (!SR) h += '<div class="warn">此瀏覽器不支援語音辨識，錄音跟讀已隱藏。建議使用電腦版 Chrome 或 Safari。</div>';
    h += "<div class=\"card\">" + (a.qs || []).map(function (q, k) {
      return '<div class="' + (k ? "q" : "") + '"><span class="tag">' + esc(q.p) + "</span> <b>" + esc(q.q) + '</b> <button type="button" class="play" data-q="' + k + '" aria-label="播放題目">▶</button>'
        + '<div class="phr">實用句型：<br>' + (q.phrases || []).map(esc).join("<br>") + "</div>"
        + '<button type="button" class="btn gray sm" data-show="' + k + '">看範例回答</button>'
        + (SR ? '<button type="button" class="btn sm" data-rec="' + k + '">錄音跟讀</button>' : "")
        + '<div class="ans" id="ans' + k + '">' + esc(q.a) + ' <button type="button" class="play" data-a="' + k + '" aria-label="播放範例">▶</button></div>'
        + '<div class="rec" id="rec' + k + '"></div></div>';
    }).join("") + "</div>";
    app.innerHTML = h;
    document.getElementById("back").onclick = function () { reader.view = "lib"; renderReader(); };
    document.getElementById("stop").onclick = stopSpeech;
    function hl(j) {
      document.querySelectorAll(".s").forEach(function (el) { el.classList.toggle("cur", +el.dataset.j === j); });
    }
    document.getElementById("all").onclick = function () {
      stopSpeech();
      reading = true;
      var j = 0;
      var next = function () {
        if (!reading || j >= ss.length) { hl(-1); reading = false; return; }
        hl(j);
        var el = document.querySelector('.s[data-j="' + j + '"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
        var spoken = ss[j];
        j += 1;
        say(spoken, next);
      };
      next();
    };
    app.onclick = function (e) {
      var t = e.target;
      if (t.closest("[data-w]")) {
        var node = t.closest("[data-w]");
        showWord(node.dataset.w, node);
        return;
      }
      if (t.dataset && t.dataset.j !== undefined && t.classList.contains("play")) {
        stopSpeech();
        var j = +t.dataset.j;
        hl(j);
        say(ss[j], function () { hl(-1); });
        return;
      }
      if (t.dataset && t.dataset.q !== undefined) { stopSpeech(); say(a.qs[+t.dataset.q].q); return; }
      if (t.dataset && t.dataset.a !== undefined) { stopSpeech(); say(a.qs[+t.dataset.a].a); return; }
      if (t.dataset && t.dataset.show !== undefined) {
        var ans = document.getElementById("ans" + t.dataset.show);
        if (ans) ans.classList.toggle("show");
        return;
      }
      if (t.dataset && t.dataset.rec !== undefined) recordAnswer(+t.dataset.rec, a, t);
    };
  }

  function recordAnswer(k, a, btn) {
    var out = document.getElementById("rec" + k);
    if (!SR || !out) return;
    if (recog) { try { recog.stop(); } catch (e) {} return; }
    try { recog = new SR(); } catch (e) { recog = null; return; }
    recog.lang = "en-GB";
    recog.interimResults = true;
    recog.continuous = true;
    var fin = "";
    out.classList.add("show");
    out.textContent = "錄音中…請說英文（可先聽範例再跟讀）";
    btn.textContent = "停止錄音";
    recog.onresult = function (ev) {
      var tmp = "";
      for (var r = ev.resultIndex; r < ev.results.length; r++) {
        if (ev.results[r].isFinal) fin += ev.results[r][0].transcript + " ";
        else tmp += ev.results[r][0].transcript;
      }
      out.innerHTML = "你說的：<br><b>" + esc(fin + tmp) + "</b>";
    };
    recog.onerror = function (ev) {
      out.innerHTML = "無法錄音（" + esc(ev.error || "") + "）。請允許使用麥克風。";
    };
    recog.onend = function () {
      recog = null;
      btn.textContent = "錄音跟讀";
      if (!fin.trim()) return;
      var sample = (a.qs[k].a || "").toLowerCase().match(/[a-z']+/g) || [];
      var tw = {};
      sample.forEach(function (w) { tw[w] = 1; });
      var said = fin.toLowerCase().match(/[a-z']+/g) || [];
      var uniq = {};
      var hit = 0;
      said.forEach(function (w) { if (!uniq[w]) { uniq[w] = 1; if (tw[w]) hit += 1; } });
      var total = Object.keys(tw).length;
      out.innerHTML = "你說的：<br><b>" + esc(fin) + "</b><br>說了 " + said.length + " 個字，與範例相同的字 " + hit + " / " + total + "。"
        + (said.length < 20 ? "<br>試著說長一點：給理由，再加一個例子。" : "<br>很好，接著注意流暢和發音。");
    };
    try { recog.start(); } catch (e) { recog = null; }
  }

  function showWord(k, el) {
    document.querySelectorAll(".w.sel").forEach(function (n) { n.classList.remove("sel"); });
    if (el) el.classList.add("sel");
    var g = glossOf(k);
    if (!g) return;
    var saved = (state.saved || []).some(function (x) { return x.w === k; });
    var sent = "";
    if (el && el.closest) {
      var box = el.closest(".s");
      if (box) sent = box.textContent.replace(/▶/g, "").trim();
    }
    pop.innerHTML = '<button type="button" class="x" id="px">✕</button><div class="wd">' + esc(k) + '</div><div class="ipa">/' + esc(g.ipa) + '/ ' + spk(k) + '</div>'
      + '<div style="margin-top:6px"><span class="tag">' + esc(g.pos) + '</span></div><div class="zh">' + esc(g.zh) + "</div>"
      + '<button type="button" class="btn sm ' + (saved ? "gray" : "") + '" id="psv">' + (saved ? "已收藏（點此移除）" : "收藏單字") + "</button>";
    pop.classList.add("show");
    say(k);
    document.getElementById("px").onclick = hidePop;
    document.getElementById("psv").onclick = function () {
      if (saved) state.saved = state.saved.filter(function (x) { return x.w !== k; });
      else state.saved.unshift({ w: k, s: sent, t: Date.now() });
      save();
      document.querySelectorAll('.w[data-w="' + cssEsc(k) + '"]').forEach(function (n) { n.classList.toggle("saved", !saved); });
      showWord(k, el);
    };
  }

  function cssEsc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-z0-9_-]/gi, "\\$&");
  }

  function hidePop() {
    pop.classList.remove("show");
    pop.innerHTML = "";
    document.querySelectorAll(".w.sel").forEach(function (n) { n.classList.remove("sel"); });
  }

  function infoOf(card) {
    if (card.type === "vocab") {
      var w = wordById[card.id];
      if (!w) return null;
      return { title: w.word, ipa: w.ipa, pos: w.pos, zh: w.zh, example: w.example, say: w.word };
    }
    var g = gById[card.id];
    if (!g) return null;
    return { title: g.label, ipa: "", pos: "文法", zh: g.explanation, example: g.example, say: "" };
  }

  function renderWords() {
    stopSpeech();
    hidePop();
    var today = E.todayStr();
    var wrongs = E.wrongItems(state, today);
    var h = "<h1>單字本</h1>";
    h += '<div class="seg"><button type="button" id="pane-wrong" class="' + (wordPane === "wrong" ? "on" : "") + '">錯題</button><button type="button" id="pane-saved" class="' + (wordPane === "saved" ? "on" : "") + '">收藏</button></div>';
    if (wordPane === "wrong") {
      h += '<div class="sub">答錯過、還沒記穩的字與文法。今天的十日練習在你打開頁面時就排好了；這裡的複習會更新之後的排程。</div>';
      if (!wrongs.length) h += '<div class="card">目前沒有待複習的錯題。</div>';
      else {
        h += '<button type="button" class="btn" id="go-wrong">複習這些錯題</button><div class="card">';
        wrongs.forEach(function (c) {
          var info = infoOf(c);
          if (!info) return;
          var due = c.due && c.due <= today;
          h += '<div class="wl"><div><b>' + esc(info.title) + "</b> " + (info.ipa ? '<span class="ipa">' + esc(info.ipa) + "</span>" : "") + "<br><span class=\"tag\">" + esc(info.pos) + "</span> " + esc(info.zh)
            + (due ? ' <span class="tag">今天到期</span>' : "")
            + '<div class="ex">' + esc(info.example) + "</div></div><div>" + (info.say ? spk(info.say) : spk(info.example)) + "</div></div>";
        });
        h += "</div>";
      }
    } else {
      var saved = state.saved || [];
      h += '<div class="sub">閱讀時點單字即可收藏。共 ' + saved.length + " 個，存在這台裝置。</div>";
      if (!saved.length) h += '<div class="card">還沒有收藏。到閱讀器點一個單字，再按收藏。</div>';
      else {
        h += '<button type="button" class="btn" id="flash">開始字卡</button><div class="card">';
        saved.forEach(function (x) {
          var g = glossOf(x.w);
          if (!g) return;
          h += '<div class="wl"><div><b>' + esc(x.w) + '</b> <span class="ipa">/' + esc(g.ipa) + '/</span><br><span class="tag">' + esc(g.pos) + "</span>" + esc(g.zh)
            + (x.s ? '<div class="sub" style="font-style:italic">' + esc(x.s) + "</div>" : "")
            + '</div><div>' + spk(x.w) + '<button type="button" class="play" data-del="' + esc(x.w) + '" style="background:#ffdfe0;color:#c00" aria-label="移除">✕</button></div></div>';
        });
        h += "</div>";
      }
    }
    app.innerHTML = h;
    document.getElementById("pane-wrong").onclick = function () { wordPane = "wrong"; renderWords(); };
    document.getElementById("pane-saved").onclick = function () { wordPane = "saved"; renderWords(); };
    var go = document.getElementById("go-wrong");
    if (go) go.onclick = function () {
      var ids = wrongs.slice(0, 10).map(function (c) { return c.type + ":" + c.id; });
      session = E.practiceQuiz(state, WORDS, GRAMMAR, E.todayStr(), ids);
      session.srs = true;
      session.title = "錯題複習";
      session.picks = session.picks || [];
      tab = "quiz";
      render();
    };
    var flash = document.getElementById("flash");
    if (flash) flash.onclick = function () { runFlash(); };
    app.querySelectorAll("[data-del]").forEach(function (b) {
      b.onclick = function () {
        state.saved = (state.saved || []).filter(function (x) { return x.w !== b.dataset.del; });
        save();
        renderWords();
      };
    });
  }

  function runFlash() {
    var list = (state.saved || []).slice().sort(function () { return Math.random() - 0.5; });
    var i = 0;
    var known = 0;
    function show() {
      if (!list.length) { renderWords(); return; }
      if (i >= list.length) {
        app.innerHTML = '<div class="card flash"><h1>複習完成</h1><p>記得 ' + known + " / " + list.length + ' 個</p><button type="button" class="btn" id="bk">回單字本</button></div>';
        document.getElementById("bk").onclick = renderWords;
        return;
      }
      var x = list[i];
      var g = glossOf(x.w) || { ipa: "", pos: "", zh: "（沒有釋義）" };
      app.innerHTML = '<div class="sub">' + (i + 1) + " / " + list.length + '</div><div class="card flash"><div class="wd">' + esc(x.w) + '</div><div class="ipa">/' + esc(g.ipa) + '/ ' + spk(x.w) + '</div>'
        + '<div id="mean" style="display:none"><div style="margin-top:10px"><span class="tag">' + esc(g.pos) + '</span></div><div class="zh">' + esc(g.zh) + "</div>"
        + (x.s ? '<div class="sub">' + esc(x.s) + "</div>" : "") + "</div>"
        + '<button type="button" class="btn gray" id="reveal">顯示意思</button>'
        + '<div id="judge" style="display:none"><button type="button" class="btn" id="yes">記得</button><button type="button" class="btn gray" id="no">再想想</button></div></div>'
        + '<button type="button" class="btn gray" id="bk">結束</button>';
      say(x.w);
      document.getElementById("reveal").onclick = function () {
        document.getElementById("mean").style.display = "block";
        document.getElementById("reveal").style.display = "none";
        document.getElementById("judge").style.display = "block";
      };
      document.getElementById("yes").onclick = function () { known += 1; i += 1; show(); };
      document.getElementById("no").onclick = function () { i += 1; show(); };
      document.getElementById("bk").onclick = renderWords;
    }
    show();
  }

  function renderStats() {
    stopSpeech();
    hidePop();
    var today = E.todayStr();
    var info = E.examInfo(state.examDate, new Date());
    var hist = state.history || {};
    var days = [];
    for (var i = 13; i >= 0; i--) {
      var d = E.addDays(today, -i);
      var row = hist[d];
      days.push({ d: d, score: row && row.completed ? row.score : 0, total: row && row.total ? row.total : 10, did: !!(row && row.completed) });
    }
    var sumS = 0, sumT = 0, nDays = 0;
    Object.keys(hist).forEach(function (d) {
      if (hist[d] && hist[d].completed) { sumS += hist[d].score; sumT += hist[d].total; nDays += 1; }
    });
    var h = "<h1>進度</h1>";
    h += '<div class="card" style="text-align:center"><div class="sub">James · 目前約 4.5–5 · 目標 6.5</div><div class="big" style="font-size:40px">' + (info.n > 0 ? info.n : 0) + '</div><div>' + esc(info.label) + "</div></div>";
    h += '<div class="stats">';
    h += '<div class="stat"><b>' + E.effectiveStreak(state, today) + '</b><span>連續天數</span></div>';
    h += '<div class="stat"><b>' + state.xp + '</b><span>經驗值</span></div>';
    h += '<div class="stat"><b>' + learnedCount() + '</b><span>答對過的單字</span></div>';
    h += '<div class="stat"><b>' + (sumT ? Math.round(sumS / sumT * 100) + "%" : "—") + '</b><span>練習正確率</span></div>';
    h += "</div>";
    h += '<div class="card"><h2>近 14 天</h2><div class="hist">';
    days.forEach(function (day) {
      var pct = day.did ? Math.max(8, Math.round(day.score / day.total * 100)) : 4;
      h += '<div class="col" title="' + esc(day.d) + '"><i style="height:' + pct + "%;background:" + (day.did ? "#58cc02" : "#e5e5e5") + '"></i><em>' + day.d.slice(8) + "</em></div>";
    });
    h += "</div></div>";
    var keys = Object.keys(hist).filter(function (d) { return hist[d] && hist[d].completed; }).sort().reverse();
    h += '<div class="card"><h2>每日紀錄</h2>';
    if (!keys.length) h += '<div class="sub">完成一次今日練習後，成績會出現在這裡。</div>';
    keys.slice(0, 30).forEach(function (d) {
      var row = hist[d];
      h += '<div class="wl"><div><b>' + esc(d) + "</b><div class=\"sub\">" + row.score + " / " + row.total + (row.wrong && row.wrong.length ? " · 錯 " + row.wrong.length + " 題" : "") + "</div></div><div>+" + (row.xpGained || 0) + " XP</div></div>";
    });
    h += "</div>";
    h += '<div class="card"><h2>設定</h2><label class="field" for="exam">考試日期</label><input id="exam" type="date" value="' + esc(state.examDate) + '">';
    h += '<p class="note">倒數、連續天數、經驗值、學過的字和每日成績都只存在這台裝置的瀏覽器，沒有帳號，也不會上傳。</p>';
    h += '<button type="button" class="btn gray" id="reset">清除本機進度</button></div>';
    h += '<p class="sub" style="text-align:center">題庫 ' + WORDS.length + " 個字 · " + GRAMMAR.length + " 題文法 · " + ARTICLES.length + " 篇文章</p>";
    app.innerHTML = h;
    document.getElementById("exam").onchange = function (ev) {
      var v = ev.target.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { state.examDate = v; save(); renderStats(); }
    };
    document.getElementById("reset").onclick = function () {
      if (!window.confirm("要清除這台裝置上的練習紀錄與單字本嗎？")) return;
      state = E.initState();
      session = null;
      ensureQuiz();
      save();
      renderStats();
    };
  }

  document.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-say]") : null;
    if (b) { ev.preventDefault(); ev.stopPropagation(); say(b.getAttribute("data-say")); return; }
    var m = ev.target.closest ? ev.target.closest("[data-mic]") : null;
    if (m) { ev.preventDefault(); ev.stopPropagation(); listen(m.getAttribute("data-mic"), m); return; }
    if (pop.classList.contains("show") && !ev.target.closest("#pop") && !(ev.target.closest && ev.target.closest("[data-w]"))) hidePop();
  }, true);

  document.getElementById("tabs").addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-tab]") : null;
    if (!b) return;
    tab = b.dataset.tab;
    stopSpeech();
    hidePop();
    render();
  });

  function boot() {
    Promise.all([
      fetch("data/words.json").then(function (r) { if (!r.ok) throw new Error("words"); return r.json(); }),
      fetch("data/grammar.json").then(function (r) { if (!r.ok) throw new Error("grammar"); return r.json(); }),
      fetch("data/articles.json").then(function (r) { if (!r.ok) throw new Error("articles"); return r.json(); }),
      fetch("data/gloss.json").then(function (r) { if (!r.ok) throw new Error("gloss"); return r.json(); })
    ]).then(function (all) {
      var bank = all[0];
      UNITS = bank.units || [];
      WORDS = bank.words || [];
      GRAMMAR = all[1];
      ARTICLES = all[2];
      GLOSS = all[3];
      WORDS.forEach(function (w) { wordById[w.id] = w; });
      GRAMMAR.forEach(function (g) { gById[g.id] = g; });
      state = loadState();
      ensureQuiz();
      render();
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      }
    }).catch(function () {
      app.innerHTML = '<div class="card"><h1>無法載入題庫</h1><p class="sub">請確認 data 資料夾裡的檔案都在，然後重新開啟這個頁面。</p></div>';
    });
  }

  boot();
})();
