/* The preview's ?demo=before|live|after|none (scripts/build-hub.ts --preview puts this file in the preview only; the real hub
   has no demo): made-up players and plays, the pots running by itself, nothing sent to the service. `none` is a week with no
   Final: the hottest game. Without ?demo= the preview shows the real week, read from the Netlify draft. */
(function () {
  var mode = new URLSearchParams(location.search).get('demo');
  var demoing = ['before', 'live', 'after', 'none'].indexOf(mode) >= 0, HOUR = 36e5, start = Date.now();
  var GAME = { slug: 'dirty-signals-radio', title: 'Dirty Signals Radio', artist: 'Bully Meow', origin: 'https://sy3mgnnh.srstudio.dev' };
  var EXTRA = '10 coffees', BONUS = 'Top 10: a Bully Meow coffee NFT', SPACE = 'https://x.com/i/spaces/1demoDEMOdemo';
  var NEXT = { slug: 'roll-call-run', title: 'ROLL CALL RUN', artist: 'LAMPWRECKED', origin: 'https://zm6f7sxk.srstudio.dev' };
  var names = ['player-one.eth', 'player-two.eth', '0x1234…abcd', 'player-four.eth', 'player-five.eth'];
  var scores = [31240, 28615, 27102, 19880, 15460], plays = {}, leaders = {};
  function iso(t) { return new Date(t).toISOString(); }
  function x5(n) { return (n * 5 / 1e5).toFixed(5); }
  function pots() {
    return liveGames(GAMES).map(function (g, i) {
      if (!(g.slug in plays)) { plays[g.slug] = [42, 31, 57, 12, 8, 23, 3, 0, 17, 5][i % 10]; leaders[g.slug] = plays[g.slug] ? { name: names[i % 5], score: 1200 + i * 977 } : null; }
      return { slug: g.slug, plays: plays[g.slug], potEth: x5(plays[g.slug]), leader: leaders[g.slug] };
    }).sort(function (a, b) { return b.plays - a.plays; });
  }
  function doc() {
    var top = names.map(function (name, i) { return { rank: i + 1, name: name, score: scores[i], eth: ['0.04', '0.025', '0.015', '0.012', '0.008'][i] }; }), f;
    /* a real Friday: the end of this week, from the page's own lisbonWeek */
    var friday = Date.parse(lisbonWeek(start).to);
    if (mode === 'before') f = { state: 'before', n: 3, from: iso(friday - 7 * HOUR), to: iso(friday), game: GAME, top: [], next: null };
    else if (mode === 'live') f = { state: 'live', n: 3, from: iso(start - 4 * HOUR), to: iso(start + 3 * HOUR), game: GAME, top: top, next: null };
    else if (mode === 'after') f = { state: 'after', n: 3, from: iso(start - 12 * HOUR), to: iso(start - 5 * HOUR), game: GAME, top: top, next: { from: iso(friday - 7 * HOUR), to: iso(friday), game: NEXT } };
    else f = { state: 'before', n: 3, from: iso(friday - 7 * HOUR), to: iso(friday), game: null, top: [], next: null };
    f.extra = EXTRA; f.bonus = BONUS; f.space = SPACE; f.places = 5; f.prizesEth = ['0.04', '0.025', '0.015', '0.012', '0.008'];
    var all = pots(), total = all.reduce(function (s, p) { return s + p.plays; }, 0);
    return { updatedAt: iso(Date.now()), week: { n: 3 }, plays: total, finaleEth: '0.1000', addEth: x5(total), games: all, finale: f, welcomeLeft: 71 };
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
    [['before', '?demo=before'], ['live', '?demo=live'], ['after', '?demo=after'], ['no final', '?demo=none'], ['real', location.pathname]].forEach(function (l) {
      var a = document.createElement('a'); a.href = l[1]; a.textContent = l[0];
      if (l[1] === '?demo=' + mode || (l[0] === 'real' && !demoing)) a.className = 'on';
      bar.appendChild(a);
    });
    document.body.insertBefore(bar, document.body.firstChild);
    var claim = document.getElementById('welcomeClaim'), said = document.getElementById('welcomeSaid'), turn = 0;
    var answers = ['5 plays are in your wallet. Pick a game: each one starts with your consent.', 'This wallet already has its 5 free plays.', 'This wallet has played here before: the 5 free plays are for new wallets. The people of the wall get 3 every Friday.', 'This week\'s 100 wallets are in. Come back after Friday 23:00 Lisbon.'];
    claim.addEventListener('click', function () { said.textContent = 'Preview, nothing granted: ' + answers[turn++ % answers.length]; });
    if (!demoing) return;
    (function run() {
      setTimeout(function () {
        var list = liveGames(GAMES), g = list[Math.floor(Math.random() * list.length)];
        if (g) plays[g.slug] = (plays[g.slug] || 0) + 1 + Math.floor(Math.random() * 2);
        if (mode === 'live') {
          var i = Math.floor(Math.random() * 5); scores[i] += 120 + Math.floor(Math.random() * 900);
          var order = scores.map(function (s, k) { return [s, names[k]]; }).sort(function (a, b) { return b[0] - a[0]; });
          scores = order.map(function (o) { return o[0]; }); names = order.map(function (o) { return o[1]; });
        }
        drawLive(doc());
        run();
      }, 1500 + Math.random() * 1500);
    })();
  });
})();
