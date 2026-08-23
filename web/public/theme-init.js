(function () {
  try {
    var p = localStorage.getItem("corps_theme") || "system";
    var d =
      p === "dark" || (p === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", d ? "dark" : "light");
  } catch (e) {}
})();
