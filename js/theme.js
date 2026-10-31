// Koti appearance: colours (Koti green or Clay orange/peach) and light/dark. Saved on this device.
// Loaded as a plain script in <head> so the right colours show before the page paints.
(function () {
  var BG = { koti: ["#eef1ee", "#121715"], clay: ["#faf1e8", "#1c1512"] };
  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function apply() {
    var palette = get("koti.palette", "koti"), mode = get("koti.mode", "auto"), r = document.documentElement;
    if (palette === "clay") r.setAttribute("data-palette", "clay"); else r.removeAttribute("data-palette");
    if (mode === "light" || mode === "dark") r.setAttribute("data-theme", mode); else r.removeAttribute("data-theme");
    var bg = BG[palette] || BG.koti, metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var dark = /dark/.test(metas[i].getAttribute("media") || "");
      metas[i].setAttribute("content", mode === "light" ? bg[0] : mode === "dark" ? bg[1] : dark ? bg[1] : bg[0]);
    }
  }
  window.kotiTheme = {
    get: function () { return { palette: get("koti.palette", "koti"), mode: get("koti.mode", "auto") }; },
    set: function (k, v) { try { localStorage.setItem("koti." + k, v); } catch (e) {} apply(); },
  };
  apply();
})();
