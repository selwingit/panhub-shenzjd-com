const API_BASE = "/api";

export function useAuth() {
  const locked = useState("auth-locked", () => false);
  const loading = useState("auth-loading", () => true);
  const error = useState("auth-error", () => "");

  async function fetchStatus() {
    loading.value = true;
    error.value = "";
    try {
      const data = await $fetch<{ locked: boolean }>(`${API_BASE}/auth/status`);
      locked.value = !!data.locked;
    } catch (e: any) {
      locked.value = true;
      error.value = e?.data?.message || e?.message || "获取状态失败";
    } finally {
      loading.value = false;
    }
  }

  async function unlock(password: string): Promise<boolean> {
    error.value = "";
    const pwd = (password || "").trim();
    if (!pwd) return false;
    try {
      await $fetch<{ ok: boolean }>(`${API_BASE}/auth/unlock`, {
        method: "POST",
        body: { password: pwd },
        credentials: "include",
      });
      locked.value = false;
      return true;
    } catch (e: any) {
      const msg = e?.data?.message || e?.message || "解锁失败";
      error.value = msg === "invalid password" ? "密码错误" : msg;
      return false;
    }
  }

  return { locked, loading, error, fetchStatus, unlock };
}
