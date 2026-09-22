"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  const [isRegister, setIsRegister] = useState(false); // 切换登录/注册
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      alert("请填写用户名和密码");
      return;
    }
    if (password.length < 6) {
      alert("密码长度至少需要 6 位");
      return;
    }

    setLoading(true);

    // 核心技巧：把用户名伪装成邮箱格式，骗过 Supabase 的认证系统
    const fakeEmail = `${username.trim()}@team-slots.local`;

    try {
      if (isRegister) {
        // 注册流程
        const { error } = await supabase.auth.signUp({
          email: fakeEmail,
          password: password,
        });
        if (error) throw error;
        alert("注册成功！已自动为您登录");
      } else {
        // 登录流程
        const { error } = await supabase.auth.signInWithPassword({
          email: fakeEmail,
          password: password,
        });
        if (error) throw error;
      }

      // 登录或注册成功后，跳转到主页
      router.push("/");
      router.refresh();

    } catch (error: any) {
      console.error(error);
      alert("操作失败：" + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-2">来牌</h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          {isRegister ? "创建一个新账号" : "使用用户名和密码登录"}
        </p >

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="例如：zhangsan"
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少6位，不要用纯数字"
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 font-medium disabled:bg-gray-400"
          >
            {loading ? "处理中..." : isRegister ? "注册并登录" : "登录"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm">
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-blue-600 hover:underline"
          >
            {isRegister ? "已有账号？去登录" : "没有账号？去注册"}
          </button>
        </div>
      </div>
    </div>
  );
}