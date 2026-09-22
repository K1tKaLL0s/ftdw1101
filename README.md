# 团队时段标记

Next.js 14 + TypeScript + Tailwind + Supabase（邮箱验证码登录）。

## 已完成

- Next.js 14 App Router 空项目
- 安装 `@supabase/supabase-js`、`@supabase/ssr`
- `supabase/schema.sql`（建表、索引、RLS）
- `.env.local.example`（只使用 anon key）

## 你需要做的（继续写代码前）

1. 打开 [Supabase](https://supabase.com)，新建一个项目。
2. **Project Settings → API** 复制：
   - Project URL
   - `anon` `public` key  
   **不要复制** `service_role` key。
3. 把 `.env.local.example` 复制为 `.env.local`，填入上面两项。
4. **SQL Editor** 打开并执行 `supabase/schema.sql`。
5. **Authentication → Providers → Email**：开启邮箱登录，并打开 OTP / 验证码相关选项（按控制台实际名称）。

## 本地运行

```bash
npm run dev
```

浏览器打开 http://localhost:3000
