/* Import txt / md / docx / pdf in the browser. Stored in IndexedDB. */
(function (root) {
  "use strict";
  var DB = "ielts-docs";
  var MAX_CHARS = 400000;

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("no-idb")); return; }
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error("abort")); };
    });
  }

  function list() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var tx = db.transaction("docs", "readonly");
        var req = tx.objectStore("docs").openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (cur) { out.push(cur.value); cur.continue(); }
        };
        req.onerror = function () { reject(req.error); };
        tx.oncomplete = function () {
          out.sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
          resolve(out);
        };
      });
    });
  }

  function put(doc) {
    return openDb().then(function (db) {
      var tx = db.transaction("docs", "readwrite");
      tx.objectStore("docs").put(doc);
      return txDone(tx).then(function () { return doc; });
    });
  }

  function get(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction("docs", "readonly").objectStore("docs").get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function remove(id) {
    return openDb().then(function (db) {
      var tx = db.transaction("docs", "readwrite");
      tx.objectStore("docs").delete(id);
      return txDone(tx);
    });
  }

  function clear() {
    return openDb().then(function (db) {
      var tx = db.transaction("docs", "readwrite");
      tx.objectStore("docs").clear();
      return txDone(tx);
    }).catch(function () {});
  }

  function readBuffer(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || "")); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file);
    });
  }

  function chunkText(text) {
    var clean = String(text || "").replace(/\r/g, "").trim();
    if (!clean) return [];
    if (clean.length > MAX_CHARS) clean = clean.slice(0, MAX_CHARS);
    var pages = [];
    var size = 1400;
    var i = 0;
    while (i < clean.length) {
      var end = Math.min(clean.length, i + size);
      if (end < clean.length) {
        var br = clean.lastIndexOf("\n", end);
        if (br > i + 400) end = br;
      }
      pages.push(clean.slice(i, end).trim());
      i = end;
    }
    return pages.filter(Boolean);
  }

  function stripMd(text) {
    return String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_`>#]/g, "");
  }

  function ensurePdf() {
    if (!window.pdfjsLib) throw new Error("no-pdf");
    if (pdfjsLib.GlobalWorkerOptions) pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }

  function extractPdf(buf, onProgress) {
    ensurePdf();
    var data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return pdfjsLib.getDocument({ data: data, disableWorker: false }).promise.then(function (pdf) {
      var pages = [];
      var total = "";
      var i = 1;
      function next() {
        if (i > pdf.numPages || total.length >= MAX_CHARS) return Promise.resolve(pages);
        onProgress && onProgress(i, pdf.numPages);
        return pdf.getPage(i).then(function (page) {
          return page.getTextContent().then(function (tc) {
            var parts = [];
            (tc.items || []).forEach(function (it) {
              if (!it.str) return;
              parts.push(it.str);
              parts.push(it.hasEOL ? "\n" : " ");
            });
            var text = parts.join("").replace(/[ \t]+\n/g, "\n").trim();
            pages.push(text);
            total += text;
            i += 1;
            return next();
          });
        });
      }
      return next().then(function () {
        return { pages: pages, pageCount: pdf.numPages, truncated: total.length >= MAX_CHARS };
      });
    });
  }

  function parseFile(file, onProgress) {
    var name = file.name || "未命名";
    var lower = name.toLowerCase();
    if (/\.pdf$/.test(lower) || file.type === "application/pdf") {
      return readBuffer(file).then(function (buf) {
        return extractPdf(buf, onProgress).then(function (res) {
          var joined = res.pages.join("\n").replace(/\s+/g, " ").trim();
          if (joined.length < Math.max(40, res.pageCount * 12)) {
            return { error: "scan" };
          }
          return {
            id: "d" + Date.now(),
            name: name,
            kind: "pdf",
            created: Date.now(),
            pages: res.pages.map(function (p) { return p || "（這一頁沒有文字）"; }),
            truncated: !!res.truncated
          };
        });
      });
    }
    if (/\.docx$/.test(lower)) {
      if (!window.mammoth) return Promise.reject(new Error("no-mammoth"));
      return readBuffer(file).then(function (buf) {
        return mammoth.extractRawText({ arrayBuffer: buf }).then(function (result) {
          var pages = chunkText(result.value || "");
          if (!pages.length) return { error: "empty" };
          return { id: "d" + Date.now(), name: name, kind: "docx", created: Date.now(), pages: pages, truncated: (result.value || "").length > MAX_CHARS };
        });
      });
    }
    return readText(file).then(function (text) {
      if (/\.md$/.test(lower)) text = stripMd(text);
      var pages = chunkText(text);
      if (!pages.length) return { error: "empty" };
      return { id: "d" + Date.now(), name: name, kind: /\.md$/.test(lower) ? "md" : "txt", created: Date.now(), pages: pages, truncated: text.length > MAX_CHARS };
    });
  }

  var STOP = {};
  "a an the of to in and or for on with from by at as is are was were be been being it this that these those i you he she we they my your his her our their not no yes if but so than then there when what which who how into about after before over under again just very can will would should could may might must do did does done have has had".split(" ").forEach(function (w) { STOP[w] = 1; });

  function sentencesOf(text) {
    var parts = String(text || "").match(/[^.!?]+[.!?]+/g);
    if (!parts) return [];
    return parts.map(function (s) { return s.replace(/\s+/g, " ").trim(); }).filter(function (s) {
      var n = (s.match(/[A-Za-z]+/g) || []).length;
      return n >= 6 && n <= 32 && s.length < 220;
    });
  }

  function tokens(text) {
    return (String(text).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []);
  }

  function buildPractice(doc, ctx) {
    var text = (doc.pages || []).join("\n");
    var sents = sentencesOf(text);
    var counts = {};
    tokens(text).forEach(function (w) {
      if (STOP[w] || w.length < 4) return;
      counts[w] = (counts[w] || 0) + 1;
    });
    var ranked = Object.keys(counts).sort(function (a, b) {
      var ab = ctx.wordByText[a] ? 2 : 0;
      var bb = ctx.wordByText[b] ? 2 : 0;
      return (bb + b.length / 10) - (ab + a.length / 10) || counts[b] - counts[a];
    });
    var usedSent = {};
    var items = [];
    ranked.forEach(function (word) {
      if (items.length >= 8) return;
      var sent = sents.filter(function (s) {
        return !usedSent[s] && new RegExp("\\b" + escReg(word) + "\\b", "i").test(s);
      })[0];
      if (!sent) return;
      usedSent[sent] = 1;
      var bank = ctx.wordByText[word];
      var distract = ranked.filter(function (w) { return w !== word; }).slice(0, 12);
      while (distractsNeed(distract)) distract.push("example", "system", "public");
      var options = [word].concat(distractsTake(distract, word));
      options = unique(options).slice(0, 4);
      while (options.length < 4) options.push("option" + options.length);
      var choices = ctx.E.shuffle(options, function () { return Math.random(); });
      var cloze = sent.replace(new RegExp("\\b" + escReg(word) + "\\b", "i"), "______");
      items.push({
        type: bank ? "vocab" : "docword",
        id: bank ? bank.id : ("doc-" + word),
        prompt: cloze,
        choices: choices,
        answer: choices.indexOf(word),
        word: bank ? bank.word : word,
        ipa: bank ? bank.ipa : "",
        meaning: bank ? bank.zh : "這份文件裡的較難單字",
        example: sent,
        display: {
          title: bank ? bank.word : word,
          ipa: bank ? String(bank.ipa).replace(/\//g, "") : "",
          pos: bank ? bank.pos : "文件單字",
          zh: bank ? bank.zh : "題庫沒有這個字的中文，句子來自你的文件。",
          example: sent,
          say: word
        }
      });
    });
    sents.slice(0, 6).forEach(function (sent, idx) {
      var original = idx % 2 === 0;
      var shown = sent;
      if (!original) {
        var words = tokens(sent).filter(function (w) { return !STOP[w] && w.length > 3; });
        var swap = ranked.filter(function (w) { return words.indexOf(w) < 0; })[0] || "tomorrow";
        if (words[0]) shown = sent.replace(new RegExp("\\b" + escReg(words[0]) + "\\b", "i"), swap);
        if (shown === sent) shown = "This sentence does not appear in the text.";
      }
      var choices = ["正確", "錯誤"];
      var answer = original ? 0 : 1;
      if (Math.random() < 0.5) {
        choices = ["錯誤", "正確"];
        answer = answer === 0 ? 1 : 0;
      }
      items.push({
        type: "read",
        id: "doc-tf-" + idx + "-" + doc.id,
        passage: (doc.pages || []).slice(0, 3).join("\n\n"),
        prompt: "這句話和文件相符嗎？\n" + shown,
        choices: choices,
        answer: answer,
        word: "文件理解",
        ipa: "",
        meaning: original ? "這句話來自文件原文。" : "這句話改了一個關鍵字，和原文不同。",
        example: sent,
        display: {
          title: "文件是非題",
          ipa: "",
          pos: "閱讀",
          zh: original ? "原文如此。" : "原文不是這句。",
          example: sent,
          say: ""
        }
      });
    });
    if (items.length < 3) return { error: "short" };
    var shadows = sents.filter(function (s) {
      var n = (s.match(/[A-Za-z]+/g) || []).length;
      return n >= 8 && n <= 22;
    }).slice(0, 4);
    var topic = guessTopic(text);
    return {
      title: doc.name,
      items: items,
      cursor: 0,
      correct: 0,
      wrong: [],
      picks: [],
      graded: {},
      done: false,
      phase: "quiz",
      practice: true,
      srs: true,
      origin: "doc",
      statKey: "doc",
      docId: doc.id,
      shadows: shadows,
      prompts: [
        { q: "What is this text mainly about?", zh: "這份文件主要在說什麼？用兩句英文說明。" },
        { q: "Which idea do you agree with, and why?", zh: "你同意哪一個看法？給一個理由。" },
        { q: topic.q, zh: topic.zh }
      ]
    };
  }

  function escReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function distractsNeed(list) { return list.length < 3; }
  function distractsTake(list, word) {
    var out = [];
    list.forEach(function (w) {
      if (out.length >= 3 || w === word) return;
      out.push(w);
    });
    return out;
  }
  function unique(arr) {
    var seen = {};
    return arr.filter(function (x) {
      if (seen[x]) return false;
      seen[x] = 1;
      return true;
    });
  }

  function guessTopic(text) {
    var t = text.toLowerCase();
    var pairs = [
      ["environment", "environment pollution climate energy", "Should ordinary people help protect the environment?", "一般人該不該幫忙保護環境？"],
      ["education", "school student teacher learn exam", "Is learning outside class as useful as school?", "課堂以外的學習和學校一樣有用嗎？"],
      ["health", "health doctor walk sleep food", "What makes a healthy daily habit hard to keep?", "健康的日常習慣為什麼難堅持？"],
      ["work", "work office job staff salary", "Is working from home a good idea?", "在家工作是好主意嗎？"],
      ["technology", "phone computer internet digital", "Do phones help people, or distract them?", "手機會幫忙，還是讓人分心？"],
      ["travel", "travel train journey trip tourist", "What are the benefits of travelling?", "旅行有什麼好處？"]
    ];
    var best = pairs[0];
    var bestN = 0;
    pairs.forEach(function (p) {
      var n = 0;
      p[1].split(" ").forEach(function (w) { if (t.indexOf(w) >= 0) n += 1; });
      if (n > bestN) { bestN = n; best = p; }
    });
    return { q: best[2], zh: best[3] };
  }

  function statusMessage(kind) {
    if (kind === "scan") return "這份 PDF 幾乎沒有可選取的文字，可能是掃描或圖片檔。本站不能辨識圖片裡的字。請改用有文字層的 PDF，或直接貼上文字。";
    if (kind === "empty") return "這個檔案裡沒有讀到文字。";
    if (kind === "short") return "文字太短，沒辦法自動出題。請再多貼幾句。";
    return "讀取失敗，請改存成 .txt 再試。";
  }

  function renderLibrary(ctx) {
    var app = ctx.app;
    app.innerHTML = '<div class="top"><span>閱讀器</span><span style="color:#58cc02">⭐ ' + (ctx.state.saved || []).length + '</span><button type="button" class="btn gray sm" id="slowbtn" style="margin:0">' + (ctx.state.slow ? "🐢 慢速：開" : "🐢 慢速：關") + "</button></div>"
      + '<div class="seg"><button type="button" id="lib-built" class="' + (ctx.reader.shelf === "mine" ? "" : "on") + '">文章庫</button><button type="button" id="lib-mine" class="' + (ctx.reader.shelf === "mine" ? "on" : "") + '">我的文件</button></div>'
      + '<div id="lib-body"><p class="sub">載入中…</p></div>';
    var slow = document.getElementById("slowbtn");
    if (slow) slow.onclick = function () { ctx.state.slow = !ctx.state.slow; ctx.save(); ctx.refresh(); };
    document.getElementById("lib-built").onclick = function () { ctx.reader.shelf = "built"; ctx.refresh(); };
    document.getElementById("lib-mine").onclick = function () { ctx.reader.shelf = "mine"; ctx.refresh(); };
    if (ctx.reader.shelf === "mine") renderMine(ctx);
    else renderBuilt(ctx);
  }

  function renderBuilt(ctx) {
    var html = "<h1>文章庫</h1><div class=\"sub\">六篇口說主題。點單字看音標與中文。</div>";
    ctx.articles.forEach(function (a, i) {
      var n = String(a.text || "").split(/\s+/).filter(Boolean).length;
      html += '<div class="card art" data-i="' + i + '"><div class="ic">' + (a.icon || "📄") + '</div><div><h2>' + ctx.esc(a.title) + '</h2><div class="sub">' + ctx.esc(a.zh || "") + " · 約 " + n + " 字</div></div></div>";
    });
    document.getElementById("lib-body").innerHTML = html;
    document.querySelectorAll("#lib-body .art").forEach(function (el) {
      el.onclick = function () { ctx.reader.view = "article"; ctx.reader.index = +el.dataset.i; ctx.refresh(); };
    });
  }

  function renderMine(ctx) {
    var body = document.getElementById("lib-body");
    body.innerHTML = "<h1>我的文件</h1><p class=\"sub\">可匯入 PDF、Word（.docx）、txt、md，或直接貼上。檔案只存在這台裝置，不會上傳。</p>"
      + '<button type="button" class="btn" id="pick">選擇檔案</button>'
      + '<input id="file" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown" style="display:none">'
      + "<h2>貼上文字</h2><textarea id=\"paste\" placeholder=\"在這裡貼上英文\"></textarea>"
      + '<button type="button" class="btn gray" id="save-paste">存成文件</button>'
      + '<div id="import-status"></div><div id="doc-list"></div>';
    document.getElementById("pick").onclick = function () { document.getElementById("file").click(); };
    document.getElementById("file").onchange = function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      importFile(ctx, file);
    };
    document.getElementById("save-paste").onclick = function () {
      var text = document.getElementById("paste").value || "";
      var pages = chunkText(text);
      if (!pages.length) { setStatus(ctx, "請先貼上文字。", true); return; }
      var doc = { id: "d" + Date.now(), name: "貼上的文字", kind: "paste", created: Date.now(), pages: pages };
      put(doc).then(function () { ctx.reader.view = "doc"; ctx.reader.docId = doc.id; ctx.refresh(); }).catch(function () { setStatus(ctx, statusMessage(""), true); });
    };
    list().then(function (docs) {
      var html = "";
      if (!docs.length) html = '<div class="card">還沒有自己的文件。</div>';
      docs.forEach(function (d) {
        var n = (d.pages || []).join(" ").split(/\s+/).filter(Boolean).length;
        html += '<div class="card"><div class="art" data-id="' + ctx.esc(d.id) + '"><div class="ic">📄</div><div><h2>' + ctx.esc(d.name) + '</h2><div class="sub">' + (d.pages || []).length + " 頁 · 約 " + n + " 字</div></div></div>"
          + '<button type="button" class="btn gray sm" data-del="' + ctx.esc(d.id) + '">刪除</button></div>';
      });
      var box = document.getElementById("doc-list");
      if (box) box.innerHTML = html;
      document.querySelectorAll("[data-id]").forEach(function (el) {
        el.onclick = function () { ctx.reader.view = "doc"; ctx.reader.docId = el.dataset.id; ctx.refresh(); };
      });
      document.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = function (ev) {
          ev.stopPropagation();
          if (!window.confirm("要刪除這份文件嗎？")) return;
          remove(b.dataset.del).then(function () { ctx.refresh(); });
        };
      });
    }).catch(function () {
      setStatus(ctx, "這台瀏覽器不能儲存文件。", true);
    });
  }

  function setStatus(ctx, msg, bad) {
    var el = document.getElementById("import-status");
    if (!el) return;
    el.innerHTML = '<div class="' + (bad ? "warn" : "note") + '">' + ctx.esc(msg) + "</div>";
  }

  function importFile(ctx, file) {
    setStatus(ctx, "正在讀取…", false);
    parseFile(file, function (i, n) {
      var el = document.getElementById("import-status");
      if (!el) return;
      var pct = Math.round(i / n * 100);
      el.innerHTML = '<div class="note">正在讀取第 ' + i + " / " + n + ' 頁</div><div class="prog"><i style="width:' + pct + '%"></i></div>';
    }).then(function (doc) {
      if (doc.error) { setStatus(ctx, statusMessage(doc.error), true); return; }
      return put(doc).then(function () {
        ctx.reader.view = "doc";
        ctx.reader.docId = doc.id;
        ctx.refresh();
      });
    }).catch(function () { setStatus(ctx, statusMessage(""), true); });
  }

  function openStored(id, ctx) {
    var app = ctx.app;
    app.innerHTML = '<p class="sub">開啟文件…</p>';
    get(id).then(function (doc) {
      if (!doc) { ctx.reader.view = "lib"; ctx.reader.shelf = "mine"; ctx.refresh(); return; }
      var page = ctx.reader.page || 0;
      if (page < 0) page = 0;
      if (page >= (doc.pages || []).length) page = 0;
      ctx.reader.page = page;
      var text = doc.pages[page] || "";
      var ss = ctx.splitSentences(text);
      if (!ss.length) ss = [text];
      var html = '<button type="button" class="btn gray sm" id="back">← 我的文件</button>';
      html += "<h1>" + ctx.esc(doc.name) + "</h1>";
      if (doc.truncated) html += '<div class="warn">檔案很長，只保存前段，避免這台裝置變慢。</div>';
      html += '<div class="pager"><button type="button" class="btn gray sm" id="prev">上一頁</button><span>' + (page + 1) + " / " + doc.pages.length + '</span><button type="button" class="btn gray sm" id="nextp">下一頁</button></div>';
      html += '<button type="button" class="btn sm" id="all">朗讀本頁</button>';
      html += '<div class="card txt">' + ss.map(function (s, j) {
        return '<span class="s" data-j="' + j + '"><button type="button" class="play" data-j="' + j + '">▶</button>' + ctx.wrapWords(s) + "</span> ";
      }).join("") + "</div>";
      html += '<button type="button" class="btn" id="practice">用這篇練習</button>';
      html += '<p class="note">點任何單字可聽發音並收藏。題庫裡沒有的字不會顯示中文。</p>';
      app.innerHTML = html;
      document.getElementById("back").onclick = function () { ctx.reader.view = "lib"; ctx.reader.shelf = "mine"; ctx.refresh(); };
      document.getElementById("prev").onclick = function () { ctx.reader.page = Math.max(0, page - 1); ctx.refresh(); };
      document.getElementById("nextp").onclick = function () { ctx.reader.page = Math.min(doc.pages.length - 1, page + 1); ctx.refresh(); };
      document.getElementById("all").onclick = function () {
        var i = 0;
        var step = function () {
          if (i >= ss.length) return;
          var s = ss[i];
          i += 1;
          ctx.say(s, step);
        };
        step();
      };
      document.getElementById("practice").onclick = function () {
        var pack = buildPractice(doc, ctx);
        if (pack.error) { window.alert(statusMessage(pack.error)); return; }
        ctx.startSession(pack);
      };
      app.onclick = function (e) {
        var t = e.target;
        if (t.closest && t.closest("[data-w]")) {
          ctx.showWord(t.closest("[data-w]").dataset.w, t.closest("[data-w]"));
          return;
        }
        if (t.dataset && t.dataset.j !== undefined && t.classList.contains("play")) {
          ctx.say(ss[+t.dataset.j]);
        }
      };
    }).catch(function () {
      app.innerHTML = '<div class="card">無法開啟這份文件。</div>';
    });
  }

  function renderShadow(q, ctx) {
    var list = q.shadows || [];
    var i = q.shadowIndex || 0;
    if (i >= list.length) { q.phase = "prompts"; ctx.refresh(); return; }
    var sent = list[i];
    var html = "<h1>跟讀</h1><p class=\"sub\">" + (i + 1) + " / " + list.length + " · 先聽，再跟讀</p>";
    html += '<div class="card"><p style="font-size:18px">' + ctx.esc(sent) + "</p>" + ctx.spk(sent) + ctx.micBtn(sent);
    if (!ctx.SR) html += ctx.micNote;
    html += '<button type="button" class="btn" id="nexts">下一句</button>';
    html += '<button type="button" class="btn gray" id="hard">這句還不順</button></div>';
    html += '<button type="button" class="btn gray" id="to-prompts">看口說題</button>';
    ctx.app.innerHTML = html;
    ctx.say(sent);
    document.getElementById("nexts").onclick = function () { q.shadowIndex = i + 1; ctx.refresh(); };
    document.getElementById("hard").onclick = function () {
      ctx.markPhrase(sent);
      q.shadowIndex = i + 1;
      ctx.refresh();
    };
    document.getElementById("to-prompts").onclick = function () { q.phase = "prompts"; ctx.refresh(); };
  }

  function renderPrompts(q, ctx) {
    var html = "<h1>口說題</h1><p class=\"sub\">依這份文件出的題目。沒有標準答案，試著自己說。</p>";
    (q.prompts || []).forEach(function (p, idx) {
      html += '<div class="card"><span class="tag">Speaking</span><h2>' + ctx.esc(p.q) + "</h2><div class=\"sub\">" + ctx.esc(p.zh) + "</div>"
        + ctx.spk(p.q) + ctx.micBtn(p.q) + "</div>";
    });
    if (!ctx.SR) html += ctx.micNote;
    html += '<button type="button" class="btn" id="done-doc">完成</button>';
    ctx.app.innerHTML = html;
    document.getElementById("done-doc").onclick = function () {
      ctx.clearSession();
      ctx.reader.view = "doc";
      ctx.refresh();
    };
  }

  root.IeltsDocs = {
    list: list,
    put: put,
    get: get,
    remove: remove,
    clear: clear,
    parseFile: parseFile,
    buildPractice: buildPractice,
    renderLibrary: renderLibrary,
    openStored: openStored,
    renderShadow: renderShadow,
    renderPrompts: renderPrompts,
    statusMessage: statusMessage
  };
})(typeof window !== "undefined" ? window : globalThis);
