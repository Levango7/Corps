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

  // 强调色偏好（F6 增强）：首帧前同步应用，避免蓝色闪烁
  try {
    var ac = localStorage.getItem("corps_accent_color");
    if (ac === "blue" || ac === "green" || ac === "purple" || ac === "orange") {
      document.documentElement.setAttribute("data-accent-color", ac);
    }
  } catch (e) {}

  // 动画效果偏好（F6 增强）：首帧前同步应用
  try {
    var mo = localStorage.getItem("corps_motion");
    if (mo === "reduced" || mo === "standard" || mo === "enhanced") {
      document.documentElement.setAttribute("data-motion", mo);
    }
  } catch (e) {}
})();
