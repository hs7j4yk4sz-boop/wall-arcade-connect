/* The preview's ?demo=before|live|after (scripts/build-hub.ts --preview puts this file in the preview only; the real hub has
   no demo): made-up players, the prizes counter running by itself, nothing sent to the service. Without ?demo= the preview
   shows the real week, read from the Netlify draft. */
(function () {
  var mode = new URLSearchParams(location.search).get('demo');
  var demoing = ['before', 'live', 'after'].indexOf(mode) >= 0, HOUR = 36e5, start = Date.now();
  var GAME = { slug: 'gate-rush', title: 'GATE RUSH', artist: 'K4NCUN0', origin: 'https://f523stv7.srstudio.dev' };
  var NEXT = { slug: 'roll-call-run', title: 'ROLL CALL RUN', artist: 'LAMPWRECKED', origin: 'https://zm6f7sxk.srstudio.dev' };
  var names = ['player-one.eth', 'player-two.eth', '0x1234…abcd', 'player-four.eth', 'player-five.eth'], plays = 128;
  var scores = [31240, 28615, 27102, 19880, 15460];
  function iso(t) { return new Date(t).toISOString(); }
  function x5(n) { return (n * 5 / 1e5).toFixed(5); }
  function doc() {
    var top = names.map(function (name, i) { return { rank: i + 1, name: name, score: scores[i], eth: '0.02' }; }), f;
    /* a real Thursday: the end of a week of the page's own lisbonWeek */
    var thursday = Date.parse(lisbonWeek(start + 7 * 24 * HOUR).to);
    if (mode === 'before') f = { state: 'before', n: 3, from: iso(thursday - 7 * HOUR), to: iso(thursday), game: GAME, top: [], next: null };
    else if (mode === 'live') f = { state: 'live', n: 3, from: iso(start - 4 * HOUR), to: iso(start + 3 * HOUR), game: GAME, top: top, next: null };
    else f = { state: 'after', n: 3, from: iso(start - 12 * HOUR), to: iso(start - 5 * HOUR), game: GAME, top: top, next: { from: iso(thursday - 7 * HOUR), to: iso(thursday), game: NEXT } };
    f.places = 5; f.eachEth = '0.02';
    return { updatedAt: iso(Date.now()), week: { n: 3 }, plays: plays, finaleEth: '0.1000', addEth: x5(plays), finale: f, welcomeLeft: 171 };
  }
  var realFetch = window.fetch;
  window.fetch = function (url, options) {
    if (demoing && String(url).indexOf('/finale.json') >= 0) return Promise.resolve(new Response(JSON.stringify(doc()), { headers: { 'Content-Type': 'application/json' } }));
    return realFetch.call(window, url, options);
  };
  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div'), css = document.createElement('style');
    css.textContent = '.demo-bar{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:8px 16px;background:#14161F;color:#FBF8EC;font:500 12px/1.4 "IBM Plex Mono",monospace}.demo-bar a{color:#FFF8A7}.demo-bar a.on{text-decoration:none;background:#FFF8A7;color:#14161F;padding:0 6px}';
    document.head.appendChild(css);
    bar.className = 'demo-bar';
    bar.appendChild(document.createTextNode(demoing ? 'PREVIEW · DEMO · fictitious data' : 'PREVIEW · real data from the draft'));
    [['before', '?demo=before'], ['live', '?demo=live'], ['after', '?demo=after'], ['real', location.pathname]].forEach(function (l) {
      var a = document.createElement('a'); a.href = l[1]; a.textContent = l[0];
      if (l[0] === mode || (l[0] === 'real' && !demoing)) a.className = 'on';
      bar.appendChild(a);
    });
    document.body.insertBefore(bar, document.body.firstChild);
    var claim = document.getElementById('welcomeClaim'), said = document.getElementById('welcomeSaid'), turn = 0;
    var answers = ['5 plays are in your wallet. Pick a game: each one starts with your consent.', 'This wallet already has its 5 free plays.', 'This wallet has played here before: the 5 free plays are for new wallets.', 'This week\'s 200 wallets are in. Come back after Thursday 23:00 Lisbon.'];
    claim.addEventListener('click', function () { said.textContent = 'Preview, nothing granted: ' + answers[turn++ % answers.length]; });
    if (!demoing) return;
    (function run() {
      setTimeout(function () {
        plays += 1 + Math.floor(Math.random() * 2);
        if (mode === 'live') { var i = Math.floor(Math.random() * 5); scores[i] += 120 + Math.floor(Math.random() * 900); }
        var order = scores.map(function (s, i) { return [s, names[i]]; }).sort(function (a, b) { return b[0] - a[0]; });
        if (mode === 'live') { scores = order.map(function (o) { return o[0]; }); names = order.map(function (o) { return o[1]; }); }
        drawLive(doc());
        run();
      }, 1500 + Math.random() * 1500);
    })();
  });
})();
