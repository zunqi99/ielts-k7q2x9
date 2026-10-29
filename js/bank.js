/* Free practice bank. Independent of the daily quiz. */
(function (root) {
  "use strict";
  var ui = { level: "home" };

  var GROUPS = [
    ["條件句", ["第二條件句", "第三條件句", "第一條件句", "unless"]],
    ["倒裝句", ["倒裝句"]],
    ["主詞動詞一致", ["主詞動詞一致"]],
    ["時態", ["現在完成式", "過去簡單式", "現在完成進行式", "過去完成式", "未來式"]],
    ["冠詞與名詞", ["冠詞", "不可數名詞", "量詞"]],
    ["關係子句", ["關係子句"]],
    ["被動語態", ["被動語態"]],
    ["比較", ["比較", "比較級", "最高級"]]
  ];

  var TOPIC = {
    academic: "學術",
    environment: "環境",
    education: "教育",
    technology: "科技",
    health: "健康",
    economy: "經濟與工作",
    society: "社會",
    culture: "文化",
    government: "政府",
    science: "科學",
    travel: "旅行",
    speaking: "口說用字",
    work: "工作"
  };

  function rng() { return Math.random(); }

  function take(list, n) {
    var copy = list.slice();
    // shuffle
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = copy[i]; copy[i] = copy[j]; copy[j] = t;
    }
    if (!n || n >= copy.length) return copy;
    return copy.slice(0, n);
  }

  function workWords(words) {
    return words.filter(function (w) {
      return /工作|職業|薪水|就業|同事|通勤|面試/.test(w.zh || "") || /wage|salary|employ|colleague|commute|staff|income/.test(w.id);
    });
  }

  function topics(ctx) {
    var list = [];
    (ctx.units || []).forEach(function (u) {
      var ws = ctx.words.filter(function (w) { return w.unit === u.id; });
      if (ws.length) list.push({ id: u.id, title: TOPIC[u.id] || u.title, words: ws });
    });
    var work = workWords(ctx.words);
    if (work.length) list.push({ id: "work", title: "工作", words: work });
    return list;
  }

  function grammarGroups(ctx) {
    var used = {};
    var out = GROUPS.map(function (g) {
      var items = ctx.grammar.filter(function (q) { return g[1].indexOf(q.point) >= 0; });
      items.forEach(function (q) { used[q.id] = 1; });
      return { id: g[0], title: g[0], items: items };
    });
    var rest = ctx.grammar.filter(function (q) { return !used[q.id]; });
    if (rest.length) out.push({ id: "其他文法", title: "其他文法", items: rest });
    return out.filter(function (g) { return g.items.length; });
  }

  function vocabQuestion(word, pool, E) {
    var cloze = E.blankExample(word.example, word.word);
    var useCloze = !!(cloze && rng() < 0.55);
    var correctText = useCloze ? word.word : word.zh;
    var same = pool.filter(function (w) { return w.id !== word.id && w.pos === word.pos; });
    if (same.length < 3) same = pool.filter(function (w) { return w.id !== word.id; });
    var distractors = [];
    var used = {};
    E.shuffle(same, rng).forEach(function (d) {
      if (distractors.length >= 3) return;
      var text = useCloze ? d.word : d.zh;
      if (!text || text === correctText || used[text]) return;
      used[text] = 1;
      distractors.push(text);
    });
    while (distractors.length < 3) distractors.push("（選項）");
    var choices = E.shuffle([correctText].concat(distractors.slice(0, 3)), rng);
    return {
      type: "vocab",
      id: word.id,
      prompt: useCloze ? (cloze + "（" + word.zh + "）") : ("「" + word.word + "」的意思是？"),
      choices: choices,
      answer: choices.indexOf(correctText),
      word: word.word,
      ipa: word.ipa,
      meaning: word.zh,
      example: word.example,
      pos: word.pos
    };
  }

  function grammarQuestion(g, E) {
    var correct = g.choices[g.answer];
    var choices = E.shuffle(g.choices.slice(), rng);
    return {
      type: "grammar",
      id: g.id,
      prompt: g.prompt,
      choices: choices,
      answer: choices.indexOf(correct),
      word: g.label,
      ipa: "",
      meaning: g.explanation,
      example: g.example,
      pos: "文法",
      display: { title: g.label, ipa: "", pos: "文法", zh: g.explanation, example: g.example, say: "" }
    };
  }

  function shuffleChoices(item, E) {
    var correct = item.choices[item.answer];
    var choices = E.shuffle(item.choices.slice(), rng);
    var copy = {};
    Object.keys(item).forEach(function (k) { copy[k] = item[k]; });
    copy.choices = choices;
    copy.answer = choices.indexOf(correct);
    return copy;
  }

  function linkFor(focus, ctx) {
    if (!focus) return null;
    var w = ctx.wordByText[String(focus).toLowerCase()];
    if (!w) return null;
    return { type: "vocab", id: w.id };
  }

  function readingItem(passage, q, ctx, E) {
    var base = {
      type: "read",
      id: q.id,
      passage: passage.title + "\n" + passage.text,
      prompt: q.prompt,
      choices: q.choices,
      answer: q.answer,
      word: q.focus || passage.title,
      ipa: "",
      meaning: q.explanation,
      example: q.evidence || passage.text.split(".")[0] + ".",
      audio: "",
      link: linkFor(q.focus, ctx),
      display: {
        title: q.focus || passage.title,
        ipa: "",
        pos: q.kind === "tfng" ? "閱讀 True/False/Not Given" : "閱讀選擇",
        zh: q.explanation,
        example: q.evidence || "",
        say: q.focus || ""
      }
    };
    return shuffleChoices(base, E);
  }

  function listeningItem(item, ctx, E) {
    var base = {
      type: "listen",
      id: item.id,
      audio: item.audio,
      prompt: item.prompt,
      choices: item.choices,
      answer: item.answer,
      word: item.focus || "聽力",
      ipa: "",
      meaning: item.explanation,
      example: item.audio,
      link: linkFor(item.focus, ctx),
      display: {
        title: item.focus || "聽力題",
        ipa: "",
        pos: item.kind === "gap" ? "聽力填空" : "聽力選擇",
        zh: item.explanation,
        example: item.audio,
        say: item.audio
      }
    };
    return shuffleChoices(base, E);
  }

  function writingItem(item, E) {
    var base = {
      type: "phrase",
      id: item.id,
      prompt: "「" + item.zh + "」最貼近的寫作英文是？",
      choices: item.choices,
      answer: item.answer,
      word: item.phrase,
      ipa: item.ipa,
      meaning: item.explanation,
      example: item.example,
      display: {
        title: item.phrase,
        ipa: String(item.ipa || "").replace(/\//g, ""),
        pos: "寫作片語",
        zh: item.zh + "。 " + item.explanation,
        example: item.example,
        say: item.phrase
      }
    };
    return shuffleChoices(base, E);
  }

  function cueItem(card) {
    return {
      type: "cue",
      id: card.id,
      part: card.part,
      topic: card.topic,
      cue: card.cue,
      points: card.points,
      phrases: card.phrases,
      model: card.model,
      display: {
        title: card.cue,
        ipa: "",
        pos: card.part,
        zh: (card.points || []).join("；"),
        example: card.model,
        say: card.model
      }
    };
  }

  function session(title, items, statKey, extra) {
    var s = {
      title: title,
      items: items,
      cursor: 0,
      correct: 0,
      wrong: [],
      picks: [],
      graded: {},
      done: false,
      phase: extra && extra.phase ? extra.phase : "quiz",
      practice: true,
      srs: true,
      origin: "bank",
      statKey: statKey
    };
    return s;
  }

  function lengthButtons(n) {
    var html = "<div class=\"sub\">這個範圍有 " + n + " 題。選一個長度，答錯會記進錯題。</div>";
    html += '<button type="button" class="btn" data-n="10">10 題</button>';
    html += '<button type="button" class="btn" data-n="20">20 題</button>';
    html += '<button type="button" class="btn gray" data-n="0">無限（全部 ' + n + " 題）</button>";
    html += '<button type="button" class="btn gray" id="bk-back">返回</button>';
    return html;
  }

  function render(ctx) {
    var app = ctx.app;
    var E = ctx.E;
    if (ui.level === "home") {
      var P = ctx.practice || {};
      var nRead = (P.reading || []).reduce(function (s, p) { return s + (p.qs || []).length; }, 0);
      app.innerHTML = "<h1>題庫</h1><p class=\"sub\">自由練習，不佔今日的 10 題。答錯的單字、文法和題目會進入錯題，並用間隔複習排程。</p>"
        + card("vocab", "字彙", "依主題練習，例如教育、環境、科技、健康、工作、旅行")
        + card("grammar", "文法", "條件句、倒裝、主詞動詞一致、時態、冠詞、關係子句、被動")
        + card("reading", "閱讀", nRead + " 題 True / False / Not Given 與選擇題")
        + card("listening", "聽力", ((P.listening || []).length) + " 題。用語音播放句子或短對話")
        + card("writing", "寫作片語", ((P.writing || []).length) + " 個 Task 2 搭配與片語")
        + card("speaking", "口說", ((P.speaking || []).length) + " 張 Part 1 / 2 / 3 題卡");
      app.querySelectorAll("[data-cat]").forEach(function (el) {
        el.onclick = function () { ui.level = el.dataset.cat; ui.key = ""; ctx.refresh(); };
      });
      return;
    }
    if (ui.level === "vocab") return renderVocab(ctx);
    if (ui.level === "grammar") return renderGrammar(ctx);
    if (ui.level === "reading") return renderReading(ctx);
    if (ui.level === "listening") return renderSimple(ctx, "聽力", (ctx.practice.listening || []).length, function (n) {
      var items = take(ctx.practice.listening, n).map(function (item) { return listeningItem(item, ctx, E); });
      ctx.startSession(session("聽力", items, "listening"));
    });
    if (ui.level === "writing") return renderSimple(ctx, "寫作片語", (ctx.practice.writing || []).length, function (n) {
      var items = take(ctx.practice.writing, n).map(function (item) { return writingItem(item, E); });
      ctx.startSession(session("寫作片語", items, "writing"));
    });
    if (ui.level === "speaking") return renderSimple(ctx, "口說題卡", (ctx.practice.speaking || []).length, function (n) {
      var items = take(ctx.practice.speaking, n).map(cueItem);
      var s = session("口說", items, "speaking", { phase: "cues" });
      ctx.startSession(s);
    });
  }

  function card(id, title, sub) {
    return '<div class="card art" data-cat="' + id + '"><div class="ic">📘</div><div><h2>' + title + '</h2><div class="sub">' + sub + "</div></div></div>";
  }

  function renderVocab(ctx) {
    var app = ctx.app;
    if (!ui.key) {
      var html = "<h1>字彙主題</h1>";
      topics(ctx).forEach(function (t) {
        html += '<button type="button" class="btn gray" data-topic="' + t.id + '">' + t.title + " · " + t.words.length + "</button>";
      });
      html += '<button type="button" class="btn" id="bk-back">返回</button>';
      app.innerHTML = html;
      app.querySelectorAll("[data-topic]").forEach(function (b) {
        b.onclick = function () { ui.key = b.dataset.topic; ctx.refresh(); };
      });
      document.getElementById("bk-back").onclick = function () { ui.level = "home"; ctx.refresh(); };
      return;
    }
    var topic = topics(ctx).filter(function (t) { return t.id === ui.key; })[0];
    app.innerHTML = "<h1>" + topic.title + "</h1>" + lengthButtons(topic.words.length);
    bindLength(ctx, function (n) {
      var pool = topic.words;
      var chosen = take(pool, n);
      var items = chosen.map(function (w) { return vocabQuestion(w, ctx.words, ctx.E); });
      ctx.startSession(session(topic.title, items, "vocab:" + topic.id));
    }, function () { ui.key = ""; ctx.refresh(); });
  }

  function renderGrammar(ctx) {
    var app = ctx.app;
    var groups = grammarGroups(ctx);
    if (!ui.key) {
      var html = "<h1>文法重點</h1>";
      groups.forEach(function (g) {
        html += '<button type="button" class="btn gray" data-g="' + g.id + '">' + g.title + " · " + g.items.length + "</button>";
      });
      html += '<button type="button" class="btn" id="bk-back">返回</button>';
      app.innerHTML = html;
      app.querySelectorAll("[data-g]").forEach(function (b) {
        b.onclick = function () { ui.key = b.dataset.g; ctx.refresh(); };
      });
      document.getElementById("bk-back").onclick = function () { ui.level = "home"; ctx.refresh(); };
      return;
    }
    var group = groups.filter(function (g) { return g.id === ui.key; })[0];
    app.innerHTML = "<h1>" + group.title + "</h1>" + lengthButtons(group.items.length);
    bindLength(ctx, function (n) {
      var items = take(group.items, n).map(function (g) { return grammarQuestion(g, ctx.E); });
      ctx.startSession(session(group.title, items, "grammar:" + group.id));
    }, function () { ui.key = ""; ctx.refresh(); });
  }

  function renderReading(ctx) {
    var app = ctx.app;
    var passages = ctx.practice.reading || [];
    if (ui.key === "mix") {
      var all = [];
      passages.forEach(function (p) { (p.qs || []).forEach(function (q) { all.push(readingItem(p, q, ctx, ctx.E)); }); });
      app.innerHTML = "<h1>閱讀混合</h1>" + lengthButtons(all.length);
      bindLength(ctx, function (n) {
        ctx.startSession(session("閱讀混合", take(all, n), "reading"));
      }, function () { ui.key = ""; ctx.refresh(); });
      return;
    }
    if (ui.key && ui.key.indexOf("p-") === 0) {
      var passage = passages.filter(function (p) { return p.id === ui.key; })[0];
      var items = (passage.qs || []).map(function (q) { return readingItem(passage, q, ctx, ctx.E); });
      ui.key = "";
      ui.level = "home";
      ctx.startSession(session(passage.title, items, "reading"));
      return;
    }
    var html = "<h1>閱讀</h1><p class=\"sub\">每篇短文搭配 True / False / Not Given 和選擇題。做題時文章會留在上方。</p>";
    html += '<button type="button" class="btn" id="mix">混合練習</button>';
    passages.forEach(function (p) {
      html += '<button type="button" class="btn gray" data-p="' + p.id + '">' + ctx.esc(p.title) + " · " + p.qs.length + " 題</button>";
    });
    html += '<button type="button" class="btn" id="bk-back">返回</button>';
    app.innerHTML = html;
    document.getElementById("mix").onclick = function () { ui.key = "mix"; ctx.refresh(); };
    app.querySelectorAll("[data-p]").forEach(function (b) {
      b.onclick = function () { ui.key = b.dataset.p; ctx.refresh(); };
    });
    document.getElementById("bk-back").onclick = function () { ui.level = "home"; ui.key = ""; ctx.refresh(); };
  }

  function renderSimple(ctx, title, n, go) {
    ctx.app.innerHTML = "<h1>" + title + "</h1>" + lengthButtons(n);
    bindLength(ctx, go, function () { ui.level = "home"; ctx.refresh(); });
  }

  function bindLength(ctx, go, back) {
    ctx.app.querySelectorAll("[data-n]").forEach(function (b) {
      b.onclick = function () { go(+b.dataset.n); };
    });
    var bk = document.getElementById("bk-back");
    if (bk) bk.onclick = back;
  }

  function renderCues(q, ctx) {
    var item = q.items[q.cursor];
    if (!item) { q.phase = "result"; q.done = true; ctx.refresh(); return; }
    var shown = false;
    var html = ctx.topBar(q.items.length ? (q.cursor / q.items.length) * 100 : 0);
    html += '<div class="card"><span class="tag">' + ctx.esc(item.part) + " · " + (q.cursor + 1) + " / " + q.items.length + "</span>";
    html += "<h1>" + ctx.esc(item.cue) + "</h1>";
    html += '<div class="sub">可以先用提示說，再對照範例。麥克風用來跟讀範例。</div>';
    html += '<div class="phr">可以說到：<br>' + (item.points || []).map(ctx.esc).join("<br>") + "</div>";
    html += '<div class="phr">實用片語：<br>' + (item.phrases || []).map(function (p) {
      return ctx.esc(p) + " " + ctx.spk(p);
    }).join("<br>") + "</div>";
    html += '<button type="button" class="btn gray" id="show-model">看範例回答</button>';
    html += '<div class="ans" id="model">' + ctx.esc(item.model) + " " + ctx.spk(item.model) + " " + ctx.micBtn(item.model) + "</div>";
    if (!ctx.SR) html += ctx.micNote;
    html += '<button type="button" class="btn" id="ok">我說得順</button>';
    html += '<button type="button" class="btn gray" id="no">還要練</button>';
    html += '<button type="button" class="btn gray" id="bk">回到題庫</button></div>';
    ctx.app.innerHTML = html;
    document.getElementById("show-model").onclick = function () {
      shown = !shown;
      document.getElementById("model").classList.toggle("show", shown);
    };
    document.getElementById("ok").onclick = function () { ctx.rate(q, true); };
    document.getElementById("no").onclick = function () { ctx.rate(q, false); };
    document.getElementById("bk").onclick = function () { ctx.clearSession(); };
  }

  root.IeltsBank = {
    render: render,
    renderCues: renderCues,
    reset: function () { ui = { level: "home" }; },
    readingItem: readingItem,
    listeningItem: listeningItem
  };
})(typeof window !== "undefined" ? window : globalThis);
