/* Markdown Studio renderer — written for safety first.
 * Every piece of user text goes through esc(); the only HTML this file emits is a fixed set of tags it writes itself.
 * Raw HTML in the Markdown is never passed through: it shows up as text.
 * Link URLs: only http(s), mailto and relative. Image URLs: only http(s) and relative. Anything else becomes inert text.
 */
(function () {
  "use strict";

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var MAX_DEPTH = 12; // nesting limit for quotes/lists, so hostile input can't blow the stack
  var PH_OPEN = "", PH_CLOSE = "", PH_STRIP = /[]/g;

  // ---------- URLs ----------
  // Returns {url, remote} or null when the URL is not allowed.
  function safeUrl(raw, isImage) {
    var u = String(raw).replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
    if (/[\u0000-\u001F\u007F]/.test(u)) return null;
    u = u.replace(/ /g, "%20");
    var m = /^([a-z][a-z0-9+.\-]*):/i.exec(u);
    if (m) {
      var scheme = m[1].toLowerCase();
      if (scheme === "http" || scheme === "https") return { url: u, remote: true };
      if (scheme === "mailto" && !isImage) return { url: u, remote: true };
      return null;
    }
    // No scheme: a colon before the first / ? # would let some parser see a scheme, so refuse it.
    var colon = u.indexOf(":"), sep = u.search(/[\/?#\\]/);
    if (colon >= 0 && (sep < 0 || colon < sep)) return null;
    return { url: u, remote: /^[\/\\]{2}/.test(u) };
  }

  function headingId(text, ctx) {
    var base = text.toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
    var id = base, n = 1;
    while (ctx.ids[id]) id = base + "-" + n++;
    ctx.ids[id] = true;
    return "md-" + id; // prefixed so a heading can never clash with the page's own element ids
  }

  // ---------- inline ----------
  function linkTail(s, j) {
    // s[j] === "(" ; returns {dest, title, end} or null
    var k = j + 1, n = s.length;
    while (k < n && (s[k] === " " || s[k] === "\t" || s[k] === "\n")) k++;
    var dest = "";
    if (s[k] === "<") {
      var close = s.indexOf(">", k);
      if (close < 0 || s.slice(k + 1, close).indexOf("\n") >= 0) return null;
      dest = s.slice(k + 1, close); k = close + 1;
    } else {
      var depth = 0, st = k;
      while (k < n) {
        var c = s[k];
        if (c === "\\" && k + 1 < n) { k += 2; continue; }
        if (c === "(") depth++;
        else if (c === ")") { if (!depth) break; depth--; }
        else if (/\s/.test(c)) break;
        k++;
      }
      dest = s.slice(st, k).replace(/\\([()\\])/g, "$1");
    }
    while (k < n && /\s/.test(s[k])) k++;
    var title = "";
    if (s[k] === '"' || s[k] === "'" || s[k] === "(") {
      var q = s[k] === "(" ? ")" : s[k], e = k + 1;
      while (e < n && s[e] !== q) { if (s[e] === "\\") e++; e++; }
      if (e >= n) return null;
      title = s.slice(k + 1, e).replace(/\\(.)/g, "$1"); k = e + 1;
      while (k < n && /\s/.test(s[k])) k++;
    }
    if (s[k] !== ")") return null;
    return { dest: dest, title: title, end: k + 1 };
  }

  function closeBracket(s, j) {
    // s[j] === "[" ; returns index of the matching "]"
    var depth = 0, stop = Math.min(s.length, j + 4000); // link text longer than this isn't a link; keeps huge input fast
    for (var k = j; k < stop; k++) {
      var c = s[k];
      if (c === "\\") { k++; continue; }
      if (c === "`") { var run = /`+/y; run.lastIndex = k; var r = run.exec(s)[0], end = s.indexOf(r, k + r.length); if (end > 0) { k = end + r.length - 1; continue; } }
      if (c === "[") depth++;
      else if (c === "]" && --depth === 0) return k;
    }
    return -1;
  }

  var ESCAPABLE = /[!-\/:-@\[-`{-~]/;
  var BARE = /https?:\/\/[^\s<]+/y;
  var AUTOLINK = /<((?:https?|mailto):[^\s<>]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>/y;

  function linkHtml(text, href, title) {
    var frag = href.url[0] === "#";
    var url = frag ? "#md-" + href.url.slice(1) : href.url;
    return '<a href="' + esc(url) + '"' + (title ? ' title="' + esc(title) + '"' : "") +
      (frag ? "" : ' target="_blank" rel="noopener noreferrer nofollow"') + ">" + text + "</a>";
  }
  function blocked(text, why) { return '<span class="md-blocked" title="' + esc(why) + '">' + text + "</span>"; }
  function plainAlt(s) { return s.replace(/[*_~`\[\]]/g, ""); }

  function inline(s, ctx, inLink) {
    var ph = [], buf = "", i = 0, n = s.length;
    function hold(html) { ph.push(html); return PH_OPEN + (ph.length - 1) + PH_CLOSE; }
    while (i < n) {
      var c = s[i], m;
      if (c === "\\" && i + 1 < n) {
        if (s[i + 1] === "\n") { buf += hold("<br>") + "\n"; i += 2; continue; }
        if (ESCAPABLE.test(s[i + 1])) { buf += hold(esc(s[i + 1])); i += 2; continue; }
      }
      if (c === "`") {
        var runRe = /`+/y; runRe.lastIndex = i;
        var run = runRe.exec(s)[0], j = i + run.length, end = -1;
        while ((j = s.indexOf(run, j)) >= 0) {
          if (s[j + run.length] !== "`" && s[j - 1] !== "`") { end = j; break; }
          j += run.length;
          while (s[j] === "`") j++;
        }
        if (end < 0) { buf += hold(esc(run)); i += run.length; continue; }
        var code = s.slice(i + run.length, end).replace(/\n/g, " ");
        if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
        buf += hold("<code>" + esc(code) + "</code>");
        i = end + run.length; continue;
      }
      if ((c === "!" && s[i + 1] === "[") || (c === "[" && !inLink)) {
        var open = c === "!" ? i + 1 : i, close = closeBracket(s, open);
        if (close > 0 && s[close + 1] === "(") {
          var tail = linkTail(s, close + 1);
          if (tail) {
            var label = s.slice(open + 1, close);
            if (c === "!") {
              var img = safeUrl(tail.dest, true), alt = plainAlt(label);
              if (!img) buf += hold(blocked("[image: " + esc(alt || "untitled") + "]", "Image URL not allowed"));
              else if (img.remote && !ctx.remoteImages) buf += hold('<span class="md-img-ph" title="' + esc(img.url) + '">🖼 ' + esc(alt || "image") + "</span>");
              else buf += hold('<img src="' + esc(img.url) + '" alt="' + esc(alt) + '"' + (tail.title ? ' title="' + esc(tail.title) + '"' : "") + ' loading="lazy" referrerpolicy="no-referrer">');
            } else {
              var href = safeUrl(tail.dest, false), inner = inline(label, ctx, true);
              buf += hold(href ? linkHtml(inner, href, tail.title) : blocked(inner, "Link removed: only http, https, mailto and relative links are allowed"));
            }
            i = tail.end; continue;
          }
        }
      }
      if (c === "<" && !inLink) {
        AUTOLINK.lastIndex = i;
        if ((m = AUTOLINK.exec(s))) {
          var target = m[1].indexOf(":") < 0 ? "mailto:" + m[1] : m[1], al = safeUrl(target, false);
          buf += hold(al ? linkHtml(esc(m[1]), al, "") : esc(m[0]));
          i += m[0].length; continue;
        }
      }
      if (c === "h" && !inLink && (i === 0 || !/[\p{L}\p{N}]/u.test(s[i - 1]))) {
        BARE.lastIndex = i;
        if ((m = BARE.exec(s))) {
          var url = m[0].replace(/[.,:;!?'"*_~]+$/, "");
          while (url.slice(-1) === ")" && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) url = url.slice(0, -1);
          var bu = safeUrl(url, false);
          if (bu) { buf += hold(linkHtml(esc(url), bu, "")); i += url.length; continue; }
        }
      }
      buf += c; i++;
    }
    var html = esc(buf)
      .replace(/\*\*\*(?=\S)([\s\S]{0,3000}?\S)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(?=\S)([\s\S]{0,3000}?\S)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]{0,3000}?\S)__(?![\p{L}\p{N}_])/gu, "$1<strong>$2</strong>")
      .replace(/\*(?=\S)([\s\S]{0,3000}?\S)\*/g, "<em>$1</em>")
      .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([\s\S]{0,3000}?\S)_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>")
      .replace(/~~(?=\S)([\s\S]{0,3000}?\S)~~/g, "<del>$1</del>")
      .replace(/ {2,}\n/g, "<br>\n");
    return html.replace(/(\d+)/g, function (x, k) { return ph[+k]; });
  }

  // ---------- blocks ----------
  var LIST = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
  var HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
  var ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
  var DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

  function startsBlock(line) { return FENCE.test(line) || ATX.test(line) || HR.test(line) || /^ {0,3}>/.test(line) || LIST.test(line); }

  function cells(line) {
    var s = line.trim();
    if (s[0] === "|") s = s.slice(1);
    if (s.slice(-1) === "|" && s.slice(-2) !== "\\|") s = s.slice(0, -1);
    var out = [], cur = "";
    for (var k = 0; k < s.length; k++) {
      if (s[k] === "\\" && s[k + 1] === "|") { cur += "\\|"; k++; }
      else if (s[k] === "|") { out.push(cur.trim()); cur = ""; }
      else cur += s[k];
    }
    out.push(cur.trim());
    return out;
  }

  function heading(level, text, ctx) {
    return "<h" + level + ' id="' + esc(headingId(text, ctx)) + '">' + inline(text, ctx) + "</h" + level + ">";
  }

  function blocks(lines, ctx, depth, tight) {
    var out = [], para = [], i = 0, m;
    function flush() {
      if (!para.length) return;
      var html = inline(para.join("\n").replace(/^\s+|\s+$/g, ""), ctx);
      out.push(tight ? html : "<p>" + html + "</p>");
      para = [];
    }
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { flush(); i++; continue; }

      if ((m = FENCE.exec(line))) {
        flush();
        var fence = m[2], indent = m[1].length, lang = m[3].replace(/[^\w+#.-]/g, "").slice(0, 32), code = [];
        var closer = new RegExp("^ {0,3}" + (fence[0] === "`" ? "`" : "~") + "{" + fence.length + ",}[ \\t]*$");
        i++;
        while (i < lines.length && !closer.test(lines[i])) {
          var l = lines[i], lead = l.search(/\S|$/);
          code.push(l.slice(Math.min(indent, lead))); i++;
        }
        i++;
        out.push('<pre class="md-pre"><code' + (lang ? ' class="lang-' + esc(lang) + '"' : "") + ">" + esc(code.join("\n")) + "</code></pre>");
        continue;
      }
      if ((m = ATX.exec(line))) { flush(); out.push(heading(m[1].length, m[2] || "", ctx)); i++; continue; }
      if (para.length && (m = /^ {0,3}(=+|-+)[ \t]*$/.exec(line))) {
        var ht = para.join("\n").trim(); para = [];
        out.push(heading(m[1][0] === "=" ? 1 : 2, ht, ctx)); i++; continue;
      }
      if (HR.test(line)) { flush(); out.push("<hr>"); i++; continue; }

      if (/^ {0,3}>/.test(line) && depth < MAX_DEPTH) {
        flush();
        var q = [];
        while (i < lines.length && lines[i].trim() && (/^ {0,3}>/.test(lines[i]) || !startsBlock(lines[i]))) {
          q.push(lines[i].replace(/^ {0,3}> ?/, "")); i++;
        }
        out.push("<blockquote>" + blocks(q, ctx, depth + 1, false) + "</blockquote>");
        continue;
      }

      m = LIST.exec(line);
      if (m && depth < MAX_DEPTH && !(para.length && (/\d/.test(m[2]) && parseInt(m[2], 10) !== 1 || !m[4]))) {
        flush();
        var ordered = /\d/.test(m[2]), kind = ordered ? m[2].slice(-1) : m[2], start = ordered ? parseInt(m[2], 10) : 1;
        var items = [], cur = null, blank = false, loose = false;
        while (i < lines.length) {
          var L = lines[i], mm = LIST.exec(L), ind = L.search(/\S|$/);
          if (!L.trim()) { if (cur) cur.lines.push(""); blank = true; i++; continue; }
          var mmKind = mm ? (/\d/.test(mm[2]) ? mm[2].slice(-1) : mm[2]) : null;
          if (mm && mmKind === kind && /\d/.test(mm[2]) === ordered && (!cur || ind < cur.ci) && !(HR.test(L) && !ordered)) {
            if (cur && blank) loose = true;
            var pad = mm[3] ? mm[3].replace(/\t/g, "    ").length : 1;
            if (pad > 4) pad = 1;
            cur = { ci: mm[1].length + mm[2].length + pad, lines: [mm[4] || ""] };
            items.push(cur); blank = false; i++; continue;
          }
          if (cur && ind >= cur.ci) { if (blank) loose = true; cur.lines.push(L.slice(cur.ci)); blank = false; i++; continue; }
          if (cur && !blank && !startsBlock(L)) { cur.lines.push(L.trim()); i++; continue; }
          break;
        }
        var tag = ordered ? "ol" : "ul", html = "<" + tag + (ordered && start !== 1 ? ' start="' + start + '"' : "") + ">";
        items.forEach(function (it) {
          while (it.lines.length && !it.lines[it.lines.length - 1].trim()) it.lines.pop();
          var task = /^\[([ xX])\](?:[ \t]+|$)/.exec(it.lines[0] || "");
          if (task) it.lines[0] = it.lines[0].slice(task[0].length);
          var body = blocks(it.lines, ctx, depth + 1, !loose);
          html += task ? '<li class="md-task"><input type="checkbox" disabled' + (task[1] !== " " ? " checked" : "") + "> " + body + "</li>" : "<li>" + body + "</li>";
        });
        out.push(html + "</" + tag + ">");
        continue;
      }

      if (line.indexOf("|") >= 0 && i + 1 < lines.length && lines[i + 1].indexOf("|") >= 0 && lines[i + 1].indexOf("-") >= 0 && DELIM.test(lines[i + 1])) {
        var head = cells(line), al = cells(lines[i + 1]).map(function (c) { return /^:-+:$/.test(c) ? "c" : /-:$/.test(c) ? "r" : /^:-/.test(c) ? "l" : ""; });
        if (head.length === al.length) {
          flush();
          var cls = function (k) { return al[k] ? ' class="al-' + al[k] + '"' : ""; };
          var t = '<div class="tbl-wrap"><table class="tbl md-table"><thead><tr>' + head.map(function (h, k) { return "<th" + cls(k) + ">" + inline(h, ctx) + "</th>"; }).join("") + "</tr></thead><tbody>";
          i += 2;
          while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
            var row = cells(lines[i]);
            t += "<tr>" + head.map(function (h, k) { return "<td" + cls(k) + ">" + inline(row[k] || "", ctx) + "</td>"; }).join("") + "</tr>";
            i++;
          }
          out.push(t + "</tbody></table></div>");
          continue;
        }
      }

      if (!para.length && /^(?: {4}|\t)/.test(line)) {
        var ic = [];
        while (i < lines.length && (/^(?: {4}|\t)/.test(lines[i]) || !lines[i].trim())) { ic.push(lines[i].replace(/^(?: {4}|\t)/, "")); i++; }
        while (ic.length && !ic[ic.length - 1].trim()) ic.pop();
        out.push('<pre class="md-pre"><code>' + esc(ic.join("\n")) + "</code></pre>");
        continue;
      }

      para.push(line); i++;
    }
    flush();
    return out.join("\n");
  }

  // opts: {remoteImages: true} renders http(s) images as <img> (for exported files); the preview shows a placeholder.
  function render(src, opts) {
    var ctx = { ids: {}, remoteImages: !!(opts && opts.remoteImages) };
    var text = String(src == null ? "" : src).replace(/\r\n?/g, "\n").replace(PH_STRIP, "").replace(/\u0000/g, "�");
    return blocks(text.split("\n"), ctx, 0, false);
  }

  window.MD = { render: render, safeUrl: safeUrl, esc: esc };
})();
