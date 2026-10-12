/**
 * visual-kit/index.js —— 统一出口（跨项目共享，CommonJS）
 * ----------------------------------------------------------------------------
 * 从 Interaction 的 theme-matrix.spec.js 抽出（v3.7.122）。
 * 用法：
 *   const { CONTRAST_INJECT, ABS_FLOOR, TOLERANCE, applyTheme, readPairs, checkOverflow, dumpReport } = require("./visual-kit/index.js");
 */

const contrast = require("./contrast.js");
const measure = require("./measure.js");
const report = require("./report.js");

module.exports = Object.assign({}, contrast, measure, report);
