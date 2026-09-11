(function () {
  try {
    var p = localStorage.getItem("corps_theme") || "system";
    var d =
      p === "dark" || (p === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", d ? "dark" : "light");
  } catch (e) {}

  // 密度偏好：首帧前同步解析，避免 comfortable 用户看到一次 compact 闪烁
  try {
    var dn = localStorage.getItem("corps_density");
    if (dn === "compact" || dn === "comfortable") {
      document.documentElement.setAttribute("data-density", dn);
    }
  } catch (e) {}
})();
