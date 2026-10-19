-- User.locale：界面/邮件语言的持久化落点
--
-- 起因：事务邮件存在 cron 定时发送路径（due-reminders / weekly-digest / ai-push-web），
-- 那里**没有 request 对象**，既读不到 NEXT_LOCALE cookie 也读不到 Accept-Language；
-- 而邮件的语言必须按**收件人**决定、不是按"发请求的这个人"。两件事合起来的结论是：
-- 语言必须落在收件人自己的行上，成为无请求上下文里唯一还读得到的信号。
-- 此前全仓唯一的 locale 出处是 NEXT_LOCALE cookie + Accept-Language 协商，只在单次
-- 请求内存活；AiVoicePreference.language 是 AI 语音合成音色，与界面/邮件无关，不复用。
--
-- 为什么是 additive + DEFAULT：Postgres 的 ADD COLUMN ... DEFAULT 'zh' 会按默认值
-- 回填存量行（PG 11+ 对非易失默认值只写 catalog、不重写表），因此不需要单独的
-- backfill 脚本；NOT NULL 也因为有 DEFAULT 而可以直接施加，存量行不会违反。
--
-- 取值域（"zh" | "en"）由应用层收口——写入侧是 apiLocale(req)（lib/api-messages.ts），
-- 读取侧是 lib/email-messages.ts 的兜底；这里不加 CHECK 约束：加了之后"支持第三种
-- 语言"会变成又一次迁移，而今天的收益只是挡住一个写入路径本就已收口的取值。

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" VARCHAR(5) NOT NULL DEFAULT 'zh';
