/* ---------- report a problem with a piece ----------------------------------
   The flag on the top-left of every card. Tapping it asks what is wrong,
   remembers the answer, and offers to file it where it can actually be acted
   on.

   HOW THE REPORT REACHES ANYONE — and the honest limit. This app is a single
   static HTML file on GitHub Pages. There is no server behind it, so nothing
   here can silently post a report anywhere; a page with no backend cannot
   "send" without either a secret to leak or a third-party endpoint to trust.
   What it does instead:

     1. every report is stored locally, so nothing is lost even offline;
     2. "Send it" opens a GitHub issue on this repo, pre-filled with the piece,
        the reason, the image URL and the shop link — one click to submit;
     3. "Copy all" hands over the whole log at once for pasting somewhere.

   The issues land in the same repo the scraper is fixed from, which is the
   point: a report about a wrong photo becomes a rule in export.py, and a report
   about a wrong section becomes a rule in 15-sectioning.js. */

const REPORT_REPO = "PattyDaGoat/Style-finder";
const REPORT_REASONS = [
  ["photo",      "The photo isn't this piece"],
  ["notclothes", "This isn't a piece of clothing"],
  ["section",    "Wrong section — this isn't menswear/womenswear"],
  ["underwear",  "This is underwear or swimwear"],
  ["link",       "The link doesn't go to the product"],
  ["dupe",       "I've already been shown this"],
  ["other",      "Something else"],
];

function reportedPiece(){
  return (typeof QUEUE !== "undefined" && QUEUE.length) ? CATALOG[QUEUE[0]] : null;
}

function openReport(e){
  if(e && e.stopPropagation) e.stopPropagation();
  const p = reportedPiece(); if(!p) return;
  const host = document.getElementById("reportHost"); if(!host) return;
  host.innerHTML =
    '<div class="rp-back" onclick="closeReport(event)">' +
      '<div class="rp-box" onclick="event.stopPropagation()">' +
        '<div class="rp-h">What\'s wrong with this piece?</div>' +
        '<div class="rp-sub">' + esc(p.b) + ' — ' + esc(p.n.slice(0, 58)) + '</div>' +
        REPORT_REASONS.map(function(r){
          return '<button class="rp-opt" onclick="fileReport(\'' + r[0] + '\')">' + esc(r[1]) + '</button>';
        }).join("") +
        '<div class="rp-foot">' +
          '<button class="btn small ghost" onclick="closeReport(event)">Cancel</button>' +
          '<button class="btn small ghost" onclick="copyReports()">Copy all reports</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function closeReport(e){
  if(e && e.stopPropagation) e.stopPropagation();
  const host = document.getElementById("reportHost");
  if(host) host.innerHTML = "";
}

function fileReport(code){
  const p = reportedPiece(); if(!p) return;
  const label = (REPORT_REASONS.find(function(r){ return r[0] === code; }) || ["", code])[1];
  const rec = { when: new Date().toISOString(), code: code, reason: label,
                brand: p.b, name: p.n, url: p.u, img: p.img,
                cat: p.cat, section: p.g, price: p.usd };
  S.reports = (S.reports || []).concat([rec]);
  save();

  const title = "[report] " + code + ": " + p.b + " — " + p.n.slice(0, 60);
  const body = [
    "**What's wrong:** " + label,
    "",
    "| field | value |",
    "|---|---|",
    "| brand | " + p.b + " |",
    "| piece | " + p.n + " |",
    "| category | " + p.cat + " |",
    "| section | " + p.g + " |",
    "| price | $" + p.usd + " |",
    "| shop link | " + p.u + " |",
    "| image | " + p.img + " |",
    "",
    "![photo](" + p.img + ")",
    "",
    "_Reported from the app on " + rec.when + "._",
  ].join("\n");
  const issue = "https://github.com/" + REPORT_REPO + "/issues/new"
              + "?labels=" + encodeURIComponent("catalog-report")
              + "&title=" + encodeURIComponent(title)
              + "&body=" + encodeURIComponent(body);

  const host = document.getElementById("reportHost");
  if(host) host.innerHTML =
    '<div class="rp-back" onclick="closeReport(event)">' +
      '<div class="rp-box" onclick="event.stopPropagation()">' +
        '<div class="rp-h">Thanks — noted</div>' +
        '<div class="rp-sub">Saved on this device (' + (S.reports.length) +
          ' report' + (S.reports.length === 1 ? '' : 's') + ' so far).</div>' +
        '<a class="rp-opt rp-go" href="' + issue + '" target="_blank" rel="noopener" ' +
           'onclick="closeReport()">Send it &rarr; opens a pre-filled report</a>' +
        '<div class="rp-foot">' +
          '<button class="btn small ghost" onclick="closeReport(event)">Not now</button>' +
          '<button class="btn small ghost" onclick="copyReports()">Copy all reports</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

/* Everything reported so far, as text — for pasting in one go. */
function reportsText(){
  const rs = S.reports || [];
  if(!rs.length) return "No reports yet.";
  return rs.map(function(r){
    return "- [" + r.code + "] " + r.brand + " — " + r.name +
           "\n    reason: " + r.reason +
           "\n    shop:   " + r.url +
           "\n    image:  " + r.img +
           "\n    when:   " + r.when;
  }).join("\n");
}

function copyReports(){
  const text = reportsText();
  const done = function(){
    const h = document.querySelector(".rp-h");
    if(h) h.textContent = "Copied " + (S.reports || []).length + " report(s)";
  };
  try {
    navigator.clipboard.writeText(text).then(done, function(){ fallbackCopy(text, done); });
  } catch(_) { fallbackCopy(text, done); }
}

function fallbackCopy(text, done){
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta); done();
  } catch(_) {}
}
