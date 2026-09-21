/**
 * json-logic-js 类型声明
 *
 * json-logic-js 是一个 UMD 模块，未提供 TypeScript 类型定义。
 * 此声明文件提供最小化的类型签名，满足条件引擎的使用需求。
 */

declare module "json-logic-js" {
  /**
   * JSON Logic 表达式 — 任意合法的 JSON Logic 规则对象
   * 如 `{ "==": [{ "var": "foo" }, "bar"] }`
   */
  type JsonLogicExpression = object;

  /**
   * 求值上下文 — 包含变量数据的对象
   * JSON Logic 表达式中的 `{ "var": "key" }` 会从此对象中取值
   */
  type JsonLogicData = Record<string, unknown>;

  /**
   * json-logic-js 主对象 — 提供条件求值能力
   */
  interface JsonLogic {
    /**
     * 对 JSON Logic 表达式求值
     *
     * @param logic - JSON Logic 表达式
     * @param data - 求值上下文数据
     * @returns 求值结果（truthy/falsy 用于条件判断）
     */
    apply(logic: JsonLogicExpression, data?: JsonLogicData): unknown;
  }

  const jsonLogic: JsonLogic;
  export default jsonLogic;
}