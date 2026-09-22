/**
 * 读取 Supabase 环境变量。
 * 只使用 anon / publishable key，绝不读取 service_role。
 */
export function getSupabaseEnv() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!rawUrl || !key) {
    throw new Error(
      "缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  // 有人会从 API 页复制成 .../rest/v1/，SDK 需要项目根地址
  const url = rawUrl.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");

  return { url, key };
}
