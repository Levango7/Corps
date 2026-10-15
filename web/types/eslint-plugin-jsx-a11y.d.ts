/**
 * eslint-plugin-jsx-a11y 的类型补丁
 * ----------------------------------------------------------------------------
 * 该插件的 package.json 里没有 types/typings 字段，DefinitelyTyped 上也没有对应的
 * @types 包，因此直接 import 会触发 TS7016（隐式 any）。仓库 tsconfig 把全部
 * ts/tsx 源文件纳入编译，所以这个报错会真实卡住 tsc --noEmit。
 *
 * 声明形状直接复用 ESLint 自己的类型（Linter.Plugin / Linter.RulesRecord），
 * 而不是自造一份 —— 自造会与 ESLint 的 Plugin.rules 具体类型对不上
 * （实测踩过：写成 Record<string, unknown> 会让 flat config 的 plugins 赋值报 TS2322）。
 *
 * 刻意不展开成完整规则枚举：抄一份会随插件升级漂移；且一旦上游补了官方类型，
 * 本文件会与之冲突 —— 届时删掉本文件、TS7016 自然消失，就是正确的处理方式。
 */
declare module "eslint-plugin-jsx-a11y" {
  import type { Linter } from "eslint";

  const plugin: Linter.Plugin & {
    /** 扁平配置预设：本仓库只用到 recommended */
    flatConfigs: {
      recommended: { rules: Linter.RulesRecord };
    };
  };

  export default plugin;
}
