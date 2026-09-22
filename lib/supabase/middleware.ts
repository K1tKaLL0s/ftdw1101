import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // 创建服务端 Supabase 客户端
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 尝试获取当前登录用户
  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    user = data.user;
  } catch (error) {
    console.log("❌ Supabase 连接失败或超时:", error);
    
    // 核心兜底逻辑：如果是本地开发环境（localhost），遇到网络问题直接放行
    // 避免在珠海这种网络环境下，因为 Supabase API 超时导致本地页面无限跳回登录页
    if (request.nextUrl.hostname === "localhost" || request.nextUrl.hostname === "127.0.0.1") {
      console.log("⚠️ 本地开发环境网络异常，跳过拦截，直接放行");
      return supabaseResponse;
    }
  }

  // 🚨 核心拦截逻辑：如果没有用户，且当前访问的不是登录页或认证回调页，强制踢回登录页
  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 如果用户已登录，或者在登录页，正常放行
  return supabaseResponse;
}