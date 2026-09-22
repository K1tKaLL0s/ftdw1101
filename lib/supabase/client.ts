"use client";

import { createBrowserClient } from "@supabase/ssr";

// 创建浏览器端 Supabase 客户端
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("缺少 Supabase 环境变量，请检查 .env.local 文件");
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}