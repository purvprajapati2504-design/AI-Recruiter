"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/app/provider";
import { supabase } from "@/lib/services/supabaseClient";
import { toast } from "sonner";

function notify(message) {
  if (typeof toast.error === "function") toast.error(message);
  else toast(message);
}

const fallbackSvgDataUri = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><rect fill='%23F3F4F6' width='160' height='160'/><g fill='%239CA3AF'><circle cx='80' cy='54' r='28'/><rect x='30' y='92' width='100' height='40' rx='20'/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
})();

function normalizeAuthUser(authUser) {
  const meta = authUser?.user_metadata ?? {};
  const creditsValue =
    typeof meta.credits === "number"
      ? meta.credits
      : Number(meta.credits ?? 0);

  return {
    id: authUser?.id ?? null,
    email: authUser?.email ?? "",
    name:
      meta.full_name ||
      meta.name ||
      meta.given_name ||
      meta.nickname ||
      (authUser?.email ? authUser.email.split("@")[0] : "User"),
    picture: meta.avatar_url || meta.picture || fallbackSvgDataUri,
    credits: Number.isFinite(creditsValue) ? creditsValue : 0,
    created_at: authUser?.created_at ?? null,
  };
}

function getHistoryKey(userId) {
  return userId ? `billing_history_${userId}` : "billing_history_guest";
}

export default function BillingPage() {
  const router = useRouter();
  const { user, setUser } = useUser();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState("main");
  const [topupAmount, setTopupAmount] = useState("");
  const [processingTopup, setProcessingTopup] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [localUser, setLocalUser] = useState(null);

  const credits = useMemo(() => {
    const value =
      typeof user?.credits === "number"
        ? user.credits
        : typeof localUser?.credits === "number"
        ? localUser.credits
        : 0;
    return value;
  }, [user?.credits, localUser?.credits]);

  const syncFromAuth = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data?.user) {
        setLocalUser(null);
        setLoading(false);
        return;
      }

      const normalized = normalizeAuthUser(data.user);
      setLocalUser(normalized);

      setUser((prev) => ({
        ...(prev || {}),
        ...normalized,
      }));
    } catch (err) {
      console.error("Error loading auth user:", err);
      notify("Unable to load account");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    syncFromAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchHistory = async () => {
    const storageUserId = user?.id || localUser?.id;
    if (!storageUserId) return;

    setHistoryLoading(true);
    try {
      const key = getHistoryKey(storageUserId);
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      setHistory(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      console.error("Error fetching billing history:", err);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, localUser?.id]);

  const saveHistoryItem = (item) => {
    const storageUserId = user?.id || localUser?.id;
    if (!storageUserId) return;

    const key = getHistoryKey(storageUserId);
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    const next = [item, ...(Array.isArray(parsed) ? parsed : [])].slice(0, 100);
    localStorage.setItem(key, JSON.stringify(next));
    setHistory(next);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await syncFromAuth();
    await fetchHistory();
    setRefreshing(false);
    toast.success("Refreshed");
  };

  const handleTopUp = async (e) => {
    e.preventDefault();

    const amount = Number(topupAmount);
    const activeUser = user || localUser;

    if (!activeUser?.id) {
      notify("Sign in to top up");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      notify("Enter a valid amount");
      return;
    }

    setProcessingTopup(true);

    try {
      const currentCredits = Number(activeUser.credits ?? 0);
      const newCredits = currentCredits + amount;

      const { data, error } = await supabase.auth.updateUser({
        data: {
          credits: newCredits,
        },
      });

      if (error) {
        throw error;
      }

      const updatedAuthUser = data?.user;
      const normalized = updatedAuthUser
        ? normalizeAuthUser(updatedAuthUser)
        : {
            ...activeUser,
            credits: newCredits,
          };

      normalized.credits = newCredits;

      setLocalUser((prev) => ({
        ...(prev || {}),
        ...normalized,
      }));

      setUser((prev) => ({
        ...(prev || {}),
        ...normalized,
      }));

      saveHistoryItem({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        amount,
        method: "manual",
        status: "success",
        created_at: new Date().toISOString(),
        notes: "Top-up via dashboard",
      });

      setTopupAmount("");
      toast.success("Top-up successful");
      setView("main");
    } catch (err) {
      console.error("Top-up failed:", err);
      notify("Top-up failed");
    } finally {
      setProcessingTopup(false);
      await fetchHistory();
    }
  };

  const handleExportHistory = () => {
    if (!history || history.length === 0) {
      toast("No history to export");
      return;
    }

    try {
      const rows = history.map((r) => ({
        id: r.id,
        amount: r.amount,
        method: r.method,
        status: r.status,
        created_at: r.created_at,
        notes: r.notes ?? "",
      }));

      const header = Object.keys(rows[0]).join(",");
      const csv = [
        header,
        ...rows.map((r) =>
          Object.values(r)
            .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
            .join(",")
        ),
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `billing_history_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("History exported");
    } catch (err) {
      console.error("Export failed:", err);
      notify("Export failed");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center py-14 px-4">
      <div className="w-full max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-800">Billing</h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage credits and view billing history
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/settings")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-slate-200 bg-white text-sm font-medium"
            >
              Return to Settings
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-slate-800 text-white text-sm font-medium disabled:opacity-70"
            >
              {refreshing ? (
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeOpacity="0.2"
                    strokeWidth="4"
                  />
                  <path
                    d="M22 12a10 10 0 00-10-10"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                "Refresh"
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-white rounded-2xl shadow px-6 py-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium text-slate-800">
                  Available Credits
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Use credits to generate interviews and AI content
                </p>
              </div>

              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-semibold text-slate-900">
                  {loading ? "—" : credits}
                </span>
                <span className="text-sm text-slate-500">credits</span>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setView("topup")}
                className="px-5 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium"
              >
                Top up credits
              </button>

              <button
                type="button"
                onClick={handleExportHistory}
                className="px-5 py-2 rounded-md border border-slate-200 bg-white text-sm font-medium"
              >
                Export history
              </button>
            </div>

            {view === "topup" && (
              <form
                onSubmit={handleTopUp}
                className="mt-8 bg-white p-6 border rounded-lg shadow-sm"
              >
                <h3 className="text-sm font-medium text-slate-800">
                  Top up credits
                </h3>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                  <input
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Amount"
                    className="sm:col-span-2 px-3 py-2 border rounded-md"
                  />

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={processingTopup}
                      className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium disabled:opacity-70"
                    >
                      {processingTopup ? "Processing…" : "Confirm top up"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setTopupAmount("");
                        setView("main");
                      }}
                      className="px-4 py-2 rounded-md border border-slate-200 bg-white text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-500">
                  This updates your Supabase Auth metadata and saves a local billing record.
                </div>
              </form>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow p-6">
            <h3 className="text-sm font-semibold text-slate-800">Account</h3>
            <div className="mt-4">
              <div className="text-sm text-slate-600">
                {user?.email || localUser?.email || "Not signed in"}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Member since:{" "}
                <span className="font-medium">
                  {user?.created_at || localUser?.created_at
                    ? new Date(user.created_at || localUser.created_at).toLocaleDateString()
                    : "—"}
                </span>
              </div>
            </div>

            <div className="mt-6">
              <h4 className="text-sm font-semibold text-slate-800">History</h4>
              <div className="mt-3 space-y-3 max-h-72 overflow-auto">
                {historyLoading ? (
                  <div className="text-sm text-slate-500">Loading history...</div>
                ) : history.length === 0 ? (
                  <div className="text-sm text-slate-500">No history yet.</div>
                ) : (
                  history.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">+{item.amount} credits</span>
                        <span className="text-xs text-emerald-600">{item.status}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {new Date(item.created_at).toLocaleString()}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{item.notes}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}