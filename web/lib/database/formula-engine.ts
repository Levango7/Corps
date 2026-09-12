/**
 * 安全的公式表达式解析 + 求值引擎
 *
 * 纯函数库，无 React 依赖，无 "use client"。
 *
 * ## 安全约束
 *
 * **禁止使用 eval / Function / new Function** —— 这些是 XSS / 代码注入攻击向量。
 * 本引擎通过手写递归下降解析器（Recursive Descent Parser）实现：
 * 1. Lexer  —— 将表达式分词为 token 流
 * 2. Parser  —— 将 token 流解析为 AST（抽象语法树）
 * 3. Evaluator —— 递归遍历 AST 求值
 *
 * 只有预定义的语法能被解析执行，任意恶意代码都无法注入。
 *
 * ## 支持的语法
 *
 * - 字段引用 `{{fieldName}}`
 * - 字符串字面量 `"hello"`（支持 `\n \t \r \\ \"` 转义）
 * - 数字字面量 `123`、`3.14`、`-5`
 * - 布尔字面量 `true`、`false`
 * - null 字面量 `null`
 * - 算术运算 `+ - * / %`
 * - 比较运算 `== != > < >= <=`
 * - 逻辑运算 `&& || !`
 * - 三元条件 `cond ? trueExpr : falseExpr`
 * - 字符串方法 `.length`、`.toUpperCase()`、`.toLowerCase()`
 * - 数学函数 `round(x)`、`floor(x)`、`ceil(x)`、`abs(x)`、`min(a, b)`、`max(a, b)`
 *
 * @example
 * evaluateFormula('{{单价}} * {{数量}}', { 单价: 10, 数量: 3 }) // 30
 * evaluateFormula('{{状态}} == "done" ? "✅" : "⏳"', { 状态: 'done' }) // "✅"
 * evaluateFormula('{{名称}}.length', { 名称: 'hello' }) // 5
 */

// ─── 公共类型 ───────────────────────────────────────────────

/** 求值上下文：字段名 → 值 */
export interface FormulaContext {
  [fieldName: string]: unknown;
}

/** 求值结果 */
export type FormulaResult = string | number | boolean | null;

/** 公式语法错误（解析阶段抛出） */
export class FormulaError extends Error {
  constructor(
    message: string,
    /** 错误在表达式中的位置（字符偏移） */
    public readonly position?: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

// ─── AST 节点（内部实现）────────────────────────────────────

type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | '&&'
  | '||';

type ASTNode =
  | { type: 'Field'; name: string }
  | { type: 'String'; value: string }
  | { type: 'Number'; value: number }
  | { type: 'Boolean'; value: boolean }
  | { type: 'Null' }
  | { type: 'UnaryOp'; op: '-' | '!'; operand: ASTNode }
  | { type: 'BinaryOp'; op: BinaryOperator; left: ASTNode; right: ASTNode }
  | { type: 'Ternary'; condition: ASTNode; trueExpr: ASTNode; falseExpr: ASTNode }
  | { type: 'Method'; object: ASTNode; method: string }
  | { type: 'Call'; name: string; args: ASTNode[] };

// ─── Lexer（词法分析）──────────────────────────────────────

type TokenType =
  | 'FIELD'
  | 'STRING'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'NULL'
  | 'IDENT'
  | 'OP'
  | 'LPAREN'
  | 'RPAREN'
  | 'DOT'
  | 'COMMA'
  | 'QUESTION'
  | 'COLON'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  /** 在原始表达式中的字符偏移 */
  pos: number;
}

/** 运算符列表，按长度降序排列，确保多字符运算符优先匹配 */
const OPERATORS: readonly string[] = [
  '==', '!=', '>=', '<=', '&&', '||',
  '+', '-', '*', '/', '%', '>', '<', '!',
];

/** 支持的数学函数名 */
const MATH_FUNCTIONS = new Set(['round', 'floor', 'ceil', 'abs', 'min', 'max']);

/** 支持的字符串方法名 */
const STRING_METHODS = new Set(['length', 'toUpperCase', 'toLowerCase']);

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isAlpha(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

/**
 * 词法分析：将表达式字符串分词为 token 流。
 * @throws FormulaError 遇到非法字符或未闭合的字面量
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;

  while (i < n) {
    const ch = expr[i];

    // 跳过空白字符
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // 字段引用 {{fieldName}}
    if (ch === '{' && expr[i + 1] === '{') {
      const start = i;
      i += 2; // 跳过 {{
      let name = '';
      while (i < n && !(expr[i] === '}' && expr[i + 1] === '}')) {
        name += expr[i];
        i++;
      }
      if (i >= n) {
        throw new FormulaError('字段引用未闭合，缺少 }}', start);
      }
      i += 2; // 跳过 }}
      const trimmed = name.trim();
      if (trimmed === '') {
        throw new FormulaError('字段引用名为空', start);
      }
      tokens.push({ type: 'FIELD', value: trimmed, pos: start });
      continue;
    }

    // 字符串字面量 "..."
    if (ch === '"') {
      const start = i;
      i++; // 跳过开始 "
      let str = '';
      while (i < n && expr[i] !== '"') {
        if (expr[i] === '\\') {
          // 转义字符
          i++;
          if (i >= n) {
            throw new FormulaError('字符串转义序列不完整', start);
          }
          const esc = expr[i];
          switch (esc) {
            case 'n': str += '\n'; break;
            case 't': str += '\t'; break;
            case 'r': str += '\r'; break;
            case '\\': str += '\\'; break;
            case '"': str += '"'; break;
            default: str += esc; break; // 未知转义：保留字符
          }
          i++;
        } else {
          str += expr[i];
          i++;
        }
      }
      if (i >= n) {
        throw new FormulaError('字符串未闭合，缺少结束引号 "', start);
      }
      i++; // 跳过结束 "
      tokens.push({ type: 'STRING', value: str, pos: start });
      continue;
    }

    // 数字字面量（含小数）
    if (isDigit(ch) || (ch === '.' && isDigit(expr[i + 1]))) {
      const start = i;
      let num = '';
      while (i < n && (isDigit(expr[i]) || expr[i] === '.')) {
        num += expr[i];
        i++;
      }
      // 验证：最多一个小数点
      if (num.split('.').length - 1 > 1) {
        throw new FormulaError(`无效的数字字面量 "${num}"`, start);
      }
      tokens.push({ type: 'NUMBER', value: num, pos: start });
      continue;
    }

    // 标识符 / 关键字（true / false / null / 函数名）
    if (isAlpha(ch)) {
      const start = i;
      let ident = '';
      while (i < n && isAlphaNum(expr[i])) {
        ident += expr[i];
        i++;
      }
      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: 'BOOLEAN', value: ident, pos: start });
      } else if (ident === 'null') {
        tokens.push({ type: 'NULL', value: ident, pos: start });
      } else {
        tokens.push({ type: 'IDENT', value: ident, pos: start });
      }
      continue;
    }

    // 单字符分隔符
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: ch, pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ch, pos: i }); i++; continue; }
    if (ch === '.') { tokens.push({ type: 'DOT', value: ch, pos: i }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'COMMA', value: ch, pos: i }); i++; continue; }
    if (ch === '?') { tokens.push({ type: 'QUESTION', value: ch, pos: i }); i++; continue; }
    if (ch === ':') { tokens.push({ type: 'COLON', value: ch, pos: i }); i++; continue; }

    // 运算符（多字符优先匹配）
    let matched = false;
    for (const op of OPERATORS) {
      if (expr.slice(i, i + op.length) === op) {
        tokens.push({ type: 'OP', value: op, pos: i });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    throw new FormulaError(`未知字符 "${ch}"`, i);
  }

  tokens.push({ type: 'EOF', value: '', pos: n });
  return tokens;
}

// ─── Parser（递归下降解析器）──────────────────────────────

/**
 * 递归下降解析器，将 token 流解析为 AST。
 *
 * 运算符优先级（从低到高）：
 *   三元 ? :  →  ||  →  &&  →  == !=  →  > < >= <=  →  + -  →  * / %  →  一元 ! -  →  后缀 .method  →  原子
 */
class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  /** 消费并返回当前 token，要求其类型（和可选值）匹配 */
  private expect(type: TokenType, value?: string): Token {
    const tok = this.peek();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new FormulaError(
        `期望 ${value ?? type}，但得到 "${tok.value || tok.type}"`,
        tok.pos,
      );
    }
    return this.advance();
  }

  /** 入口：解析整个表达式，返回 AST 根节点 */
  parse(): ASTNode {
    const node = this.parseTernary();
    if (this.peek().type !== 'EOF') {
      const tok = this.peek();
      throw new FormulaError(`意外的 token "${tok.value}"`, tok.pos);
    }
    return node;
  }

  /** 三元条件: cond ? trueExpr : falseExpr（右结合）*/
  private parseTernary(): ASTNode {
    const condition = this.parseOr();
    if (this.peek().type === 'QUESTION') {
      this.advance();
      const trueExpr = this.parseTernary();
      this.expect('COLON');
      const falseExpr = this.parseTernary();
      return { type: 'Ternary', condition, trueExpr, falseExpr };
    }
    return condition;
  }

  /** 逻辑或 ||（左结合）*/
  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.isOp('||')) {
      this.advance();
      left = { type: 'BinaryOp', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  /** 逻辑与 &&（左结合）*/
  private parseAnd(): ASTNode {
    let left = this.parseEquality();
    while (this.isOp('&&')) {
      this.advance();
      left = { type: 'BinaryOp', op: '&&', left, right: this.parseEquality() };
    }
    return left;
  }

  /** 相等 == !=（左结合）*/
  private parseEquality(): ASTNode {
    let left = this.parseComparison();
    while (this.isOp('==') || this.isOp('!=')) {
      const op = this.advance().value as '==' | '!=';
      left = { type: 'BinaryOp', op, left, right: this.parseComparison() };
    }
    return left;
  }

  /** 比较 > < >= <=（左结合）*/
  private parseComparison(): ASTNode {
    let left = this.parseAdditive();
    while (this.isOp('>') || this.isOp('<') || this.isOp('>=') || this.isOp('<=')) {
      const op = this.advance().value as '>' | '<' | '>=' | '<=';
      left = { type: 'BinaryOp', op, left, right: this.parseAdditive() };
    }
    return left;
  }

  /** 加减 + -（左结合）*/
  private parseAdditive(): ASTNode {
    let left = this.parseMultiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.advance().value as '+' | '-';
      left = { type: 'BinaryOp', op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  /** 乘除 * / %（左结合）*/
  private parseMultiplicative(): ASTNode {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.advance().value as '*' | '/' | '%';
      left = { type: 'BinaryOp', op, left, right: this.parseUnary() };
    }
    return left;
  }

  /** 一元 ! -（右结合）*/
  private parseUnary(): ASTNode {
    const tok = this.peek();
    if (tok.type === 'OP' && (tok.value === '!' || tok.value === '-')) {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'UnaryOp', op: tok.value as '!' | '-', operand };
    }
    return this.parsePostfix();
  }

  /** 后缀 .method（左结合）*/
  private parsePostfix(): ASTNode {
    let node = this.parsePrimary();
    while (this.peek().type === 'DOT') {
      this.advance();
      const methodTok = this.expect('IDENT');
      // 方法可带空括号调用，如 .toUpperCase()
      if (this.peek().type === 'LPAREN') {
        this.advance();
        this.expect('RPAREN'); // 当前方法不接受参数
      }
      node = { type: 'Method', object: node, method: methodTok.value };
    }
    return node;
  }

  /** 原子：字段、字面量、括号表达式、函数调用 */
  private parsePrimary(): ASTNode {
    const tok = this.peek();

    switch (tok.type) {
      case 'FIELD':
        this.advance();
        return { type: 'Field', name: tok.value };

      case 'STRING':
        this.advance();
        return { type: 'String', value: tok.value };

      case 'NUMBER':
        this.advance();
        return { type: 'Number', value: parseFloat(tok.value) };

      case 'BOOLEAN':
        this.advance();
        return { type: 'Boolean', value: tok.value === 'true' };

      case 'NULL':
        this.advance();
        return { type: 'Null' };

      case 'LPAREN': {
        this.advance();
        const node = this.parseTernary();
        this.expect('RPAREN');
        return node;
      }

      case 'IDENT': {
        // 函数调用 name(arg1, arg2, ...)
        this.advance();
        this.expect('LPAREN');
        const args: ASTNode[] = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseTernary());
          while (this.peek().type === 'COMMA') {
            this.advance();
            args.push(this.parseTernary());
          }
        }
        this.expect('RPAREN');
        return { type: 'Call', name: tok.value, args };
      }

      default:
        throw new FormulaError(
          `意外的 token "${tok.value || tok.type}"`,
          tok.pos,
        );
    }
  }

  /** 辅助：当前 token 是否为指定运算符 */
  private isOp(op: string): boolean {
    const tok = this.peek();
    return tok.type === 'OP' && tok.value === op;
  }
}

// ─── Evaluator（AST 求值）──────────────────────────────────

/** 判断 truthy / falsy（null / 0 / "" / false 为 falsy）*/
function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (v === false) return false;
  if (v === 0) return false;
  if (v === '') return false;
  return true;
}

/** 强制转 number（string→parseFloat，boolean→0/1，null→0）*/
function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** 强制转 string */
function toString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** 将 context 中的值规范化为 FormulaResult（只允许基本类型）*/
function normalizeFieldValue(val: unknown): FormulaResult {
  if (val === null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val;
  // undefined 或复杂类型（对象/数组）→ null
  return null;
}

/** 递归求值 AST 节点 */
function evaluate(node: ASTNode, context: FormulaContext): FormulaResult {
  switch (node.type) {
    case 'Field':
      return normalizeFieldValue(context[node.name]);

    case 'String':
      return node.value;

    case 'Number':
      return node.value;

    case 'Boolean':
      return node.value;

    case 'Null':
      return null;

    case 'UnaryOp': {
      if (node.op === '!') {
        return !isTruthy(evaluate(node.operand, context));
      }
      // 一元负号
      return -toNumber(evaluate(node.operand, context));
    }

    case 'BinaryOp': {
      const left = evaluate(node.left, context);
      const right = evaluate(node.right, context);
      return evalBinaryOp(node.op, left, right);
    }

    case 'Ternary': {
      const cond = evaluate(node.condition, context);
      return isTruthy(cond)
        ? evaluate(node.trueExpr, context)
        : evaluate(node.falseExpr, context);
    }

    case 'Method': {
      const obj = evaluate(node.object, context);
      return evalMethod(node.method, obj);
    }

    case 'Call': {
      const args = node.args.map((a) => evaluate(a, context));
      return evalCall(node.name, args);
    }

    default:
      // 穷尽性保护：所有 AST 节点类型已处理
      return null;
  }
}

/** 二元运算求值 */
function evalBinaryOp(
  op: BinaryOperator,
  left: FormulaResult,
  right: FormulaResult,
): FormulaResult {
  switch (op) {
    case '+':
      // 任一操作数为 string → 字符串拼接；否则数值加法
      if (typeof left === 'string' || typeof right === 'string') {
        return toString(left) + toString(right);
      }
      return toNumber(left) + toNumber(right);

    case '-':
      return toNumber(left) - toNumber(right);

    case '*':
      return toNumber(left) * toNumber(right);

    case '/': {
      const r = toNumber(right);
      if (r === 0) return null; // 除以零 → null
      return toNumber(left) / r;
    }

    case '%': {
      const r = toNumber(right);
      if (r === 0) return null; // 模零 → null
      return toNumber(left) % r;
    }

    case '==':
      return compareEq(left, right);

    case '!=':
      return !compareEq(left, right);

    case '>':
      return compare(left, right) > 0;

    case '<':
      return compare(left, right) < 0;

    case '>=':
      return compare(left, right) >= 0;

    case '<=':
      return compare(left, right) <= 0;

    case '&&':
      return isTruthy(left) && isTruthy(right);

    case '||':
      return isTruthy(left) || isTruthy(right);

    default:
      // 穷尽性保护
      return null;
  }
}

/**
 * 相等比较。
 * - null == null → true
 * - null == 非 null → false
 * - 同类型 → 直接 ===
 * - 不同类型 → 转 string 后比较
 */
function compareEq(a: FormulaResult, b: FormulaResult): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (typeof a === typeof b) return a === b;
  // 不同类型：转 string 比较
  return toString(a) === toString(b);
}

/**
 * 大小比较，返回 -1 / 0 / 1。
 * - 同类型（number / string / boolean）直接比较
 * - 不同类型转 string 后按字典序比较
 */
function compare(a: FormulaResult, b: FormulaResult): number {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return (a ? 1 : 0) - (b ? 1 : 0);
  }
  // 不同类型：转 string 按字典序比较
  const sa = toString(a);
  const sb = toString(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/** 字符串方法求值 */
function evalMethod(method: string, obj: FormulaResult): FormulaResult {
  if (!STRING_METHODS.has(method)) {
    return null; // 未知方法 → null
  }
  const str = toString(obj);
  switch (method) {
    case 'length':
      return str.length;
    case 'toUpperCase':
      return str.toUpperCase();
    case 'toLowerCase':
      return str.toLowerCase();
    default:
      return null;
  }
}

/** 数学函数求值 */
function evalCall(name: string, args: FormulaResult[]): FormulaResult {
  if (!MATH_FUNCTIONS.has(name)) {
    return null; // 未知函数 → null
  }
  const nums = args.map(toNumber);

  switch (name) {
    case 'round':
      if (nums.length !== 1) return null;
      return Math.round(nums[0]);

    case 'floor':
      if (nums.length !== 1) return null;
      return Math.floor(nums[0]);

    case 'ceil':
      if (nums.length !== 1) return null;
      return Math.ceil(nums[0]);

    case 'abs':
      if (nums.length !== 1) return null;
      return Math.abs(nums[0]);

    case 'min':
      if (nums.length < 1) return null;
      return Math.min(...nums);

    case 'max':
      if (nums.length < 1) return null;
      return Math.max(...nums);

    default:
      return null;
  }
}

// ─── 公共 API ───────────────────────────────────────────────

/**
 * 解析并求值公式表达式。
 *
 * - **语法错误**（未闭合引号、未知运算符等）→ 抛出 `FormulaError`
 * - **运行时错误**（字段不存在、除以零、类型不匹配等）→ 返回 `null`
 *
 * @example
 * evaluateFormula('{{单价}} * {{数量}}', { 单价: 10, 数量: 3 }) // 30
 * evaluateFormula('{{状态}} == "done" ? "✅" : "⏳"', { 状态: 'done' }) // "✅"
 * evaluateFormula('{{价格}} > 100 ? "昂贵" : "便宜"', { 价格: 200 }) // "昂贵"
 * evaluateFormula('{{名称}}.length', { 名称: 'hello' }) // 5
 * evaluateFormula('{{分数}} / {{总分}} * 100', { 分数: 85, 总分: 100 }) // 85
 */
export function evaluateFormula(
  expression: string,
  context: FormulaContext,
): FormulaResult {
  const tokens = tokenize(expression);
  const ast = new Parser(tokens).parse();
  return evaluate(ast, context);
}

/**
 * 验证公式语法。
 *
 * @returns `null` 表示语法有效；否则返回错误消息字符串。
 *
 * @example
 * validateFormula('{{单价}} * {{数量}}') // null
 * validateFormula('{{单价}} *') // "期望 ...，但得到 ..."
 */
export function validateFormula(expression: string): string | null {
  try {
    const tokens = tokenize(expression);
    new Parser(tokens).parse();
    return null;
  } catch (e) {
    if (e instanceof FormulaError) return e.message;
    return String(e);
  }
}

/**
 * 提取公式中引用的字段名列表（去重，保持首次出现顺序）。
 *
 * 仅做词法提取，不要求完整语法有效 —— 这样在公式编辑过程中
 * （表达式可能暂时不完整）也能实时提取依赖字段。
 *
 * @example
 * extractFieldReferences('{{单价}} * {{数量}} + {{单价}}') // ['单价', '数量']
 * extractFieldReferences('{{状态}} == "done" ? "✅" : "⏳"') // ['状态']
 */
export function extractFieldReferences(expression: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  try {
    const tokens = tokenize(expression);
    for (const tok of tokens) {
      if (tok.type === 'FIELD' && !seen.has(tok.value)) {
        seen.add(tok.value);
        names.push(tok.value);
      }
    }
  } catch {
    // 词法错误时返回已成功提取的部分（可能为空）
  }
  return names;
}