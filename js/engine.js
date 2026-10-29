/* Daily quiz, spaced repetition, and progress. No network. */
(function (root) {
  "use strict";
  var INTERVALS = [2, 4, 8, 16, 32];
  var SEED_VOCAB = ["substantial", "allocate", "ambiguous", "mitigate", "prevalent"];
  var SEED_GRAMMAR = ["g-second-if-had", "g-hardly-inversion", "g-number-of-has"];

  function pad(n) { return String(n).padStart(2, "0"); }

  function formatDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function todayStr(now) {
    return formatDate(now || new Date());
  }

  function parseDate(iso) {
    var p = String(iso).split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function addDays(iso, n) {
    var dt = parseDate(iso);
    dt.setDate(dt.getDate() + n);
    return formatDate(dt);
  }

  function daysBetween(fromIso, toIso) {
    return Math.round((parseDate(toIso) - parseDate(fromIso)) / 86400000);
  }

  function examInfo(examDate, now) {
    var today = todayStr(now);
    var n = daysBetween(today, examDate);
    if (n > 0) return { n: n, label: "考試倒數 " + n + " 天" };
    if (n === 0) return { n: 0, label: "今天是考試日" };
    return { n: n, label: "考試日已過 " + (-n) + " 天" };
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function escapeReg(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function blankExample(example, word) {
    var re = new RegExp("\\b" + escapeReg(word) + "\\b", "i");
    if (!re.test(example)) return null;
    return example.replace(re, "______");
  }

  function cardKey(type, id) { return type + ":" + id; }

  function initState(now) {
    var today = todayStr(now);
    var cards = {};
    SEED_VOCAB.forEach(function (id) {
      cards[cardKey("vocab", id)] = { type: "vocab", id: id, box: 0, due: today, correct: 0, wrong: 1, seen: 0 };
    });
    SEED_GRAMMAR.forEach(function (id) {
      cards[cardKey("grammar", id)] = { type: "grammar", id: id, box: 0, due: today, correct: 0, wrong: 1, seen: 0 };
    });
    return {
      v: 1,
      examDate: "2027-06-07",
      xp: 0,
      streak: 0,
      lastStudyDate: null,
      introduced: [],
      learned: {},
      cards: cards,
      history: {},
      saved: [],
      slow: false,
      quiz: null,
      bankStats: {}
    };
  }

  function ensureCard(state, type, id) {
    var k = cardKey(type, id);
    if (!state.cards[k]) {
      state.cards[k] = { type: type, id: id, box: 0, due: null, correct: 0, wrong: 0, seen: 0 };
    }
    return state.cards[k];
  }

  function isDue(card, today) {
    return !!(card && card.due && card.due <= today);
  }

  function touchStreak(state, today) {
    if (!state.lastStudyDate) return;
    var y = addDays(today, -1);
    if (state.lastStudyDate !== today && state.lastStudyDate !== y) state.streak = 0;
  }

  function effectiveStreak(state, today) {
    if (!state.lastStudyDate) return 0;
    if (state.lastStudyDate === today || state.lastStudyDate === addDays(today, -1)) return state.streak;
    return 0;
  }

  function byUrgency(orderMap) {
    return function (a, b) {
      var aw = a.wrong || 0, bw = b.wrong || 0;
      if (bw !== aw) return bw - aw;
      var ab = a.box || 0, bb = b.box || 0;
      if (ab !== bb) return ab - bb;
      return (orderMap.get(a.id) || 0) - (orderMap.get(b.id) || 0);
    };
  }

  function buildVocabQuestion(word, words, today, rng) {
    var style = hashStr(today + ":style:" + word.id) % 2;
    var cloze = blankExample(word.example, word.word);
    var useCloze = style === 0 && !!cloze;
    var pool = words.filter(function (w) { return w.id !== word.id; });
    var same = pool.filter(function (w) { return w.pos === word.pos; });
    if (same.length < 3) same = pool;
    var distractors = [];
    var used = {};
    var correctText = useCloze ? word.word : word.zh;
    function take(list) {
      var order = shuffle(list, rng);
      for (var i = 0; i < order.length && distractors.length < 3; i++) {
        var text = useCloze ? order[i].word : order[i].zh;
        if (!text || text === correctText || used[text]) continue;
        used[text] = 1;
        distractors.push(text);
      }
    }
    take(same);
    if (distractors.length < 3) take(pool);
    var choices = shuffle([correctText].concat(distractors), rng);
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

  function buildGrammarQuestion(g, rng) {
    var correct = g.choices[g.answer];
    var choices = shuffle(g.choices.slice(), rng);
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
      pos: ""
    };
  }

  function generateQuiz(state, words, grammar, today) {
    var rng = mulberry32(hashStr("quiz:" + today));
    var byId = {};
    var wordOrder = new Map();
    words.forEach(function (w, i) { byId[w.id] = w; wordOrder.set(w.id, i); });
    var gById = {};
    var gOrder = new Map();
    grammar.forEach(function (g, i) { gById[g.id] = g; gOrder.set(g.id, i); });

    var dueVocab = [];
    var dueGrammar = [];
    Object.keys(state.cards).forEach(function (k) {
      var c = state.cards[k];
      if (!isDue(c, today)) return;
      if (c.type === "vocab" && byId[c.id]) dueVocab.push(c);
      if (c.type === "grammar" && gById[c.id]) dueGrammar.push(c);
    });
    dueVocab.sort(byUrgency(wordOrder));
    dueGrammar.sort(byUrgency(gOrder));

    var vocabIds = [];
    var grammarIds = [];
    var seenV = {};
    var seenG = {};
    dueVocab.forEach(function (c) {
      if (vocabIds.length >= 7) return;
      vocabIds.push(c.id);
      seenV[c.id] = 1;
    });
    dueGrammar.forEach(function (c) {
      if (grammarIds.length >= 3) return;
      grammarIds.push(c.id);
      seenG[c.id] = 1;
    });

    words.forEach(function (w) {
      if (vocabIds.length >= 7) return;
      if (seenV[w.id]) return;
      var c = state.cards[cardKey("vocab", w.id)];
      if (c && c.due && c.due > today) return;
      if (c && c.seen && !isDue(c, today)) return;
      vocabIds.push(w.id);
      seenV[w.id] = 1;
    });
    if (vocabIds.length < 7) {
      var rest = words.filter(function (w) { return !seenV[w.id]; }).map(function (w) {
        var c = state.cards[cardKey("vocab", w.id)];
        return { id: w.id, due: c && c.due ? c.due : "9999-99-99", box: c ? c.box : 0 };
      }).sort(function (a, b) {
        if (a.due < b.due) return -1;
        if (a.due > b.due) return 1;
        return a.box - b.box;
      });
      rest.forEach(function (r) {
        if (vocabIds.length >= 7) return;
        vocabIds.push(r.id);
      });
    }

    grammar.forEach(function (g) {
      if (grammarIds.length >= 3) return;
      if (seenG[g.id]) return;
      var c = state.cards[cardKey("grammar", g.id)];
      if (c && c.due && c.due > today) return;
      grammarIds.push(g.id);
      seenG[g.id] = 1;
    });
    if (grammarIds.length < 3) {
      grammar.forEach(function (g) {
        if (grammarIds.length >= 3 || seenG[g.id]) return;
        grammarIds.push(g.id);
        seenG[g.id] = 1;
      });
    }

    var items = [];
    vocabIds.forEach(function (id) { items.push(buildVocabQuestion(byId[id], words, today, rng)); });
    grammarIds.forEach(function (id) { items.push(buildGrammarQuestion(gById[id], rng)); });
    return {
      date: today,
      items: items,
      cursor: 0,
      correct: 0,
      wrong: [],
      graded: {},
      done: false,
      replay: false,
      phase: "home"
    };
  }

  function practiceQuiz(state, words, grammar, today, ids) {
    var rng = mulberry32(hashStr("practice:" + today + ":" + ids.join(",")));
    var byId = {};
    words.forEach(function (w) { byId[w.id] = w; });
    var gById = {};
    grammar.forEach(function (g) { gById[g.id] = g; });
    var items = [];
    ids.forEach(function (key) {
      var parts = key.split(":");
      var type = parts[0];
      var id = parts.slice(1).join(":");
      if (type === "vocab" && byId[id]) items.push(buildVocabQuestion(byId[id], words, today + ":p", rng));
      if (type === "grammar" && gById[id]) items.push(buildGrammarQuestion(gById[id], rng));
    });
    return {
      date: today,
      items: items,
      cursor: 0,
      correct: 0,
      wrong: [],
      graded: {},
      done: false,
      replay: false,
      practice: true,
      phase: "quiz"
    };
  }

  function gradeQuestion(state, item, picked, today, skipSrs, opts) {
    var ok = picked === item.answer;
    if (skipSrs) return ok;
    var card = ensureCard(state, item.type, item.id);
    if (item.display) card.display = item.display;
    card.seen = (card.seen || 0) + 1;
    if (item.type === "vocab" && !(opts && opts.skipIntro)) {
      if (state.introduced.indexOf(item.id) < 0) state.introduced.push(item.id);
    }
    if (ok) {
      card.correct = (card.correct || 0) + 1;
      card.box = Math.min(5, (card.box || 0) + 1);
      card.due = addDays(today, INTERVALS[card.box - 1]);
      if (item.type === "vocab") state.learned[item.id] = true;
    } else {
      card.wrong = (card.wrong || 0) + 1;
      card.box = 0;
      card.due = addDays(today, 1);
    }
    return ok;
  }

  function finishQuiz(state, quiz, today) {
    if (quiz.practice) {
      quiz.done = true;
      return { xpGained: 0, first: false };
    }
    var score = quiz.correct;
    var total = quiz.items.length;
    var prev = state.history[today];
    var first = !(prev && prev.completed);
    var xpGained = 0;
    if (first) {
      xpGained = score * 10;
      state.xp += xpGained;
      var y = addDays(today, -1);
      if (state.lastStudyDate === y) state.streak += 1;
      else if (state.lastStudyDate !== today) state.streak = 1;
      state.lastStudyDate = today;
    }
    var best = prev && prev.completed ? Math.max(prev.score, score) : score;
    state.history[today] = {
      score: best,
      total: total,
      xpGained: ((prev && prev.xpGained) || 0) + xpGained,
      completed: true,
      wrong: quiz.wrong.map(function (w) { return { type: w.type, id: w.id, word: w.word }; }),
      at: new Date().toISOString()
    };
    quiz.done = true;
    return { xpGained: xpGained, first: first };
  }

  function pathModel(state, words, units) {
    var intro = {};
    (state.introduced || []).forEach(function (id) { intro[id] = 1; });
    var groups = units.map(function (u) {
      var ws = words.filter(function (w) { return w.unit === u.id; });
      var lessonCount = u.lessons || 5;
      var per = Math.max(1, Math.ceil(ws.length / lessonCount));
      var lessons = [];
      for (var i = 0; i < lessonCount; i++) {
        var slice = ws.slice(i * per, Math.min(ws.length, (i + 1) * per));
        var doneN = slice.filter(function (w) { return intro[w.id]; }).length;
        lessons.push({
          index: i,
          total: slice.length,
          done: doneN,
          complete: slice.length > 0 && doneN === slice.length
        });
      }
      var introducedN = ws.filter(function (w) { return intro[w.id]; }).length;
      return {
        id: u.id,
        title: u.title,
        grammar: u.grammar || [],
        total: ws.length,
        introduced: introducedN,
        lessons: lessons,
        complete: ws.length > 0 && introducedN === ws.length
      };
    });
    var currentUnit = 0;
    for (var ui = 0; ui < groups.length; ui++) {
      if (!groups[ui].complete) { currentUnit = ui; break; }
      currentUnit = ui;
    }
    var lessons = groups[currentUnit] ? groups[currentUnit].lessons : [];
    var currentLesson = 0;
    for (var li = 0; li < lessons.length; li++) {
      if (!lessons[li].complete) { currentLesson = li; break; }
      currentLesson = li;
    }
    return { groups: groups, currentUnit: currentUnit, currentLesson: currentLesson };
  }

  function wrongItems(state, today) {
    var list = [];
    Object.keys(state.cards).forEach(function (k) {
      var c = state.cards[k];
      if ((c.wrong || 0) <= 0) return;
      if ((c.box || 0) >= 3 && c.due && c.due > today) return;
      list.push(c);
    });
    list.sort(function (a, b) {
      var ad = a.due && a.due <= today ? 0 : 1;
      var bd = b.due && b.due <= today ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return (b.wrong || 0) - (a.wrong || 0);
    });
    return list;
  }

  root.IeltsEngine = {
    INTERVALS: INTERVALS,
    SEED_VOCAB: SEED_VOCAB,
    SEED_GRAMMAR: SEED_GRAMMAR,
    todayStr: todayStr,
    addDays: addDays,
    daysBetween: daysBetween,
    examInfo: examInfo,
    hashStr: hashStr,
    shuffle: shuffle,
    blankExample: blankExample,
    initState: initState,
    ensureCard: ensureCard,
    isDue: isDue,
    touchStreak: touchStreak,
    effectiveStreak: effectiveStreak,
    generateQuiz: generateQuiz,
    practiceQuiz: practiceQuiz,
    gradeQuestion: gradeQuestion,
    finishQuiz: finishQuiz,
    pathModel: pathModel,
    wrongItems: wrongItems,
    cardKey: cardKey
  };
})(typeof window !== "undefined" ? window : globalThis);
