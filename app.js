/* Markdown Studio — editor, preview, export. The renderer (md.js) escapes everything; see the self-test below. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var input = $("#input"), preview = $("#preview"), grid = $("#grid"), savedEl = $("#saved"), statsEl = $("#stats");

  var WELCOME = [
    "# Welcome to Markdown Studio",
    "",
    "Write **Markdown** on the left and the preview updates as you type. Everything stays on *this device*.",
    "",
    "## What you can use",
    "",
    "- Headings, **bold**, *italic*, ~~strikethrough~~ and `inline code`",
    "- [Links](https://s3eidat.github.io/) and bare URLs like https://github.com/s3eidat",
    "- Nested lists",
    "  1. numbered",
    "  2. or not",
    "",
    "### Tasks",
    "",
    "- [x] Write the draft",
    "- [x] Check the preview",
    "- [ ] Export to PDF",
    "",
    "> Raw HTML is shown as text, never run: <script>alert('hi')</script>",
    "",
    "| Feature | Shortcut | Works |",
    "| :------ | :------: | ----: |",
    "| Bold | Ctrl+B | yes |",
    "| Italic | Ctrl+I | yes |",
    "| Link | Ctrl+K | yes |",
    "",
    "```js",
    "function hello(name) {",
    "  return `Hello, ${name}!`;",
    "}",
    "```",
    "",
    "---",
    "",
    "Made with Markdown Studio. Export with the buttons above."
  ].join("\n");

  // ---------- preview ----------
  function words(t) { var m = t.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu); return m ? m.length : 0; }
  function update() {
    preview.innerHTML = MD.render(input.value); // safe: MD.render escapes all input (proved in S3_SELFTEST)
    var w = words(input.value);
    statsEl.textContent = w.toLocaleString() + " words · " + Array.from(input.value).length.toLocaleString() + " characters · " +
      Math.max(1, Math.round(w / 238)) + " min read";
  }
  var save = S3.debounce(function () {
    S3.store("md.text", input.value);
    savedEl.textContent = "Saved on this device";
  }, 500);
  input.addEventListener("input", function () { savedEl.textContent = "Saving…"; update(); save(); });

  // ---------- toolbar ----------
  function insert(text, selStart, selEnd) {
    var start = input.selectionStart;
    input.focus();
    // execCommand keeps the browser's undo history; fall back to setRangeText where it isn't supported.
    if (!document.execCommand || !document.execCommand("insertText", false, text)) {
      input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
      input.dispatchEvent(new Event("input"));
    }
    if (selStart != null) input.setSelectionRange(start + selStart, start + selEnd);
  }
  function wrap(before, after, placeholder) {
    var a = input.selectionStart, b = input.selectionEnd, sel = input.value.slice(a, b) || placeholder;
    insert(before + sel + after, before.length, before.length + sel.length);
  }
  function lines(fn) {
    var v = input.value, a = v.lastIndexOf("\n", input.selectionStart - 1) + 1, b = v.indexOf("\n", input.selectionEnd);
    if (b < 0) b = v.length;
    input.setSelectionRange(a, b);
    var out = v.slice(a, b).split("\n").map(fn).join("\n");
    insert(out, 0, out.length);
  }
  function block(text) {
    var v = input.value, a = input.selectionStart;
    var pre = a === 0 || v[a - 1] === "\n" ? (a > 1 && v[a - 2] !== "\n" ? "\n" : "") : "\n\n";
    insert(pre + text + "\n");
  }
  var ACTIONS = {
    bold: function () { wrap("**", "**", "bold text"); },
    italic: function () { wrap("*", "*", "italic text"); },
    strike: function () { wrap("~~", "~~", "struck text"); },
    code: function () { wrap("`", "`", "code"); },
    link: function () {
      var a = input.selectionStart, b = input.selectionEnd, sel = input.value.slice(a, b) || "link text";
      insert("[" + sel + "](https://)", sel.length + 3, sel.length + 11);
    },
    image: function () { insert("![description](image.png)", 2, 13); },
    h2: function () { lines(function (l) { var m = /^(#{1,5}) /.exec(l); return m ? "#" + l : /^###### /.test(l) ? l.replace(/^#+ /, "") : "## " + l; }); },
    ul: function () { lines(function (l) { return /^- /.test(l) ? l.slice(2) : "- " + l; }); },
    ol: function () { var n = 0; lines(function (l) { return /^\d+\. /.test(l) ? l.replace(/^\d+\. /, "") : ++n + ". " + l; }); },
    task: function () { lines(function (l) { return /^- \[[ x]\] /.test(l) ? l.slice(6) : "- [ ] " + l; }); },
    quote: function () { lines(function (l) { return /^> ?/.test(l) ? l.replace(/^> ?/, "") : "> " + l; }); },
    fence: function () { var sel = input.value.slice(input.selectionStart, input.selectionEnd) || "code"; block("```\n" + sel + "\n```"); },
    table: function () { block("| Column | Column |\n| ------ | ------ |\n| Cell   | Cell   |"); },
    hr: function () { block("---"); }
  };
  $("#tools").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (b) ACTIONS[b.dataset.act]();
  });
  input.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = e.key.toLowerCase(), act = { b: "bold", i: "italic", k: "link" }[k];
    if (act) { e.preventDefault(); ACTIONS[act](); }
  });

  // ---------- view + sync scroll ----------
  var view = S3.store("md.view") || "split";
  $$("#view button").forEach(function (b) {
    b.setAttribute("aria-pressed", String(b.dataset.v === view));
    b.addEventListener("click", function () {
      view = b.dataset.v; grid.dataset.view = view; S3.store("md.view", view);
      $$("#view button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    });
  });
  grid.dataset.view = view;
  var syncing = null;
  function follow(from, to) {
    if (!$("#sync").checked || syncing === to) { syncing = null; return; }
    var max = from.scrollHeight - from.clientHeight;
    syncing = from;
    to.scrollTop = max > 0 ? from.scrollTop / max * (to.scrollHeight - to.clientHeight) : 0;
  }
  input.addEventListener("scroll", function () { follow(input, preview); });
  preview.addEventListener("scroll", function () { follow(preview, input); });

  // ---------- files ----------
  function title() {
    var m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(input.value);
    return m ? m[1].replace(/[*_`~\[\]]/g, "").trim() : "Document";
  }
  function fileBase() { return title().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "document"; }
  var EXPORT_CSS = "body{margin:0;background:#fff;color:#1b1f24;font:16px/1.7 system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Arabic',sans-serif}" +
    "article{max-width:760px;margin:40px auto;padding:0 20px}h1,h2{border-bottom:1px solid #e3e6ea;padding-bottom:.25em}" +
    "a{color:#0b6bcb}code{font:.9em ui-monospace,Consolas,monospace;background:#f2f4f7;padding:1px 5px;border-radius:5px}" +
    "pre{background:#f2f4f7;padding:12px 14px;border-radius:10px;overflow:auto}pre code{background:none;padding:0}" +
    "blockquote{margin:0 0 1em;padding:.2em 1em;border-left:3px solid #0e9f9a;color:#4f5866;background:#f7f8fa}" +
    "table{border-collapse:collapse;width:100%}th,td{border:1px solid #e3e6ea;padding:6px 10px;text-align:left}" +
    ".al-c{text-align:center}.al-r{text-align:right}img{max-width:100%}li.md-task{list-style:none;margin-left:-1.3em}" +
    "hr{border:0;border-top:1px solid #d5d9df}.md-blocked{color:#b42318}";
  function exportHtml() {
    return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'\">\n" +
      "<title>" + S3.esc(title()) + "</title>\n<style>" + EXPORT_CSS + "</style>\n</head>\n<body>\n<article dir=\"auto\">\n" +
      MD.render(input.value, { remoteImages: true }) + "\n</article>\n</body>\n</html>\n";
  }
  $("#saveMd").addEventListener("click", function () { S3.download(input.value, fileBase() + ".md", "text/markdown;charset=utf-8"); S3.done(); });
  $("#saveHtml").addEventListener("click", function () { S3.download(exportHtml(), fileBase() + ".html", "text/html;charset=utf-8"); S3.done(); });
  $("#copyHtml").addEventListener("click", function () { S3.copy(MD.render(input.value, { remoteImages: true }), "HTML copied"); S3.done(); });
  $("#print").addEventListener("click", function () { update(); window.print(); S3.done(); });
  function load(text) { input.value = text; update(); S3.store("md.text", text); savedEl.textContent = "Saved on this device"; input.scrollTop = 0; }
  $("#open input").addEventListener("change", function (e) {
    var f = e.target.files[0]; if (!f) return;
    S3.readFile(f, "text").then(load);
    e.target.value = "";
  });
  input.addEventListener("dragover", function (e) { e.preventDefault(); });
  input.addEventListener("drop", function (e) {
    var f = e.dataTransfer.files[0]; if (!f) return;
    e.preventDefault(); S3.readFile(f, "text").then(load);
  });

  var stored = S3.store("md.text");
  input.value = typeof stored === "string" ? stored : WELCOME;
  update();
  if (typeof stored === "string") savedEl.textContent = "Restored from this device";

  window.S3_DEMO = function () { input.value = WELCOME; update(); };

  // ---------- self-test: the renderer must make hostile input inert ----------
  window.S3_SELFTEST = function () {
    var fails = [];
    function parse(html) { var t = document.createElement("template"); t.innerHTML = html; return t.content; }
    function check(name, ok) { if (!ok) fails.push(name); }

    var attack = [
      "<img src=x onerror=alert(1)>",
      "[x](javascript:alert(1))",
      "[y](JaVaScRiPt:alert(1))",
      "[z](  javascript:alert(1))",
      "[w](java\u0009script:alert(1))",
      "[q](<javascript:alert(1)>)",
      "[e](vbscript:msgbox(1))",
      "[d](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
      "![i](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)",
      "![j](javascript:alert(1))",
      "<script>alert(1)</script>",
      "<a href=\"javascript:alert(1)\">h</a>",
      "<javascript:alert(1)>",
      "[t](https://s3eidat.github.io/ \"x\\\" onmouseover=\\\"alert(1)\")",
      "[ent](&#106;avascript:alert(1))",
      "```\"><img src=x onerror=alert(1)>\ncode\n```",
      "| <b onmouseover=alert(1)>h</b> |\n| --- |\n| [c](javascript:alert(1)) |",
      "# <svg onload=alert(1)>",
      "- [x] <iframe src=javascript:alert(1)>",
      "> <style>*{display:none}</style>"
    ].join("\n\n");
    var html = MD.render(attack), doc = parse(html);
    var allowedTags = /^(H[1-6]|P|BR|HR|STRONG|EM|DEL|CODE|PRE|BLOCKQUOTE|UL|OL|LI|A|IMG|INPUT|SPAN|DIV|TABLE|THEAD|TBODY|TR|TH|TD)$/;
    Array.prototype.forEach.call(doc.querySelectorAll("*"), function (el) {
      check("tag " + el.tagName, allowedTags.test(el.tagName));
      Array.prototype.forEach.call(el.attributes, function (a) {
        check("attr " + a.name, !/^on/i.test(a.name) && /^(href|src|alt|title|class|id|type|disabled|checked|start|target|rel|loading|referrerpolicy)$/.test(a.name));
        if (a.name === "href") check("href " + a.value, /^(https?:|mailto:|#|[^:]*$|[^:]*[\/?#])/i.test(a.value) && !/^\s*(javascript|data|vbscript):/i.test(a.value));
        if (a.name === "src") check("src " + a.value, !/:/.test(a.value.split(/[\/?#]/)[0]));
      });
      if (el.tagName === "IMG") check("remote img", !/^https?:|^\/\//i.test(el.getAttribute("src")));
    });
    check("no js in output", !/(href|src)="\s*(javascript|data|vbscript):/i.test(html));
    check("raw html shown as text", doc.textContent.indexOf("<img src=x onerror=alert(1)>") >= 0 && doc.textContent.indexOf("<script>alert(1)</script>") >= 0);
    check("link text kept", doc.textContent.indexOf("x") >= 0 && doc.querySelectorAll(".md-blocked").length >= 8);
    ["javascript:alert(1)", " javascript:x", "JAVASCRIPT:x", "java\tscript:x", "data:text/html,x", "vbscript:x", "\u0000javascript:x", "javascript\u0000:x", "&#106;avascript:x"].forEach(function (u) {
      var r = MD.safeUrl(u, false);
      check("safeUrl " + JSON.stringify(u), r === null || !/^[a-z]+:/i.test(r.url) && !/javascript/i.test(r.url.split(/[\/?#]/)[0].replace(/&#106;/, "")));
    });
    check("safeUrl ok", MD.safeUrl("https://s3eidat.github.io/", false).url === "https://s3eidat.github.io/" && MD.safeUrl("mailto:a@b.co", false) && !MD.safeUrl("mailto:a@b.co", true) && MD.safeUrl("docs/a b.md", false).url === "docs/a%20b.md");

    // Known answers for the Markdown itself.
    var known = [
      ["# Hi\n\n**b** and *i* `c<d>`", '<h1 id="md-hi">Hi</h1>\n<p><strong>b</strong> and <em>i</em> <code>c&lt;d&gt;</code></p>'],
      ["~~s~~ ***bi*** snake_case_name", "<p><del>s</del> <strong><em>bi</em></strong> snake_case_name</p>"],
      ["- a\n- b\n  - c", "<ul><li>a</li><li>b\n<ul><li>c</li></ul></li></ul>"],
      ["3. x\n4. y", '<ol start="3"><li>x</li><li>y</li></ol>'],
      ["- [x] done\n- [ ] todo", '<ul><li class="md-task"><input type="checkbox" disabled checked> done</li><li class="md-task"><input type="checkbox" disabled> todo</li></ul>'],
      ["```js\n<b>x</b>\n```", '<pre class="md-pre"><code class="lang-js">&lt;b&gt;x&lt;/b&gt;</code></pre>'],
      ["> quote\n> > nested", "<blockquote><p>quote</p>\n<blockquote><p>nested</p></blockquote></blockquote>"],
      ["Title\n===\n\n***", '<h1 id="md-title">Title</h1>\n<hr>'],
      ["[s](https://s3eidat.github.io/ \"T\")", '<p><a href="https://s3eidat.github.io/" title="T" target="_blank" rel="noopener noreferrer nofollow">s</a></p>'],
      ["![a](https://s3eidat.github.io/a.png)", '<p><span class="md-img-ph" title="https://s3eidat.github.io/a.png">🖼 a</span></p>'],
      ["[go](#hi) \\*no em\\*", '<p><a href="#md-hi">go</a> *no em*</p>'],
      ["a  \nb", "<p>a<br>\nb</p>"]
    ];
    known.forEach(function (k, n) { var got = MD.render(k[0]); if (got !== k[1]) fails.push("known #" + n + ": " + got); });
    var tbl = parse(MD.render("| a | b |\n|:-:|--:|\n| 1 | 2 \\| 3 |"));
    check("table", tbl.querySelectorAll("th").length === 2 && tbl.querySelectorAll("td").length === 2 && tbl.querySelectorAll("td")[1].className === "al-r" && tbl.querySelectorAll("td")[1].textContent === "2 | 3");
    var t0 = Date.now(); MD.render("*a ".repeat(20000) + "\n\n" + "[".repeat(20000) + "\n\n" + ">".repeat(3000) + " deep");
    check("hostile input stays fast", Date.now() - t0 < 3000);
    return fails.length ? fails.join(" | ") : true;
  };
})();
