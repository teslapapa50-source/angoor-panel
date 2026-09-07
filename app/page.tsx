'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Presence = {
  id?: number;
  user_id: number;
  username: string;
  display_name: string | null;
  job_id: string;
  place_id: number | null;
  last_seen: string;
  device: string | null;
  executor: string | null;
};

function isActive(lastSeen: string) {
  return Date.now() - new Date(lastSeen).getTime() < 45000;
}

function ago(lastSeen: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function Page() {
  const [rows, setRows] = useState<Presence[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tpPopup, setTpPopup] = useState(false);
  const [activePlayers, setActivePlayers] = useState<Presence[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null);

  const load = useCallback(async () => {
    setErr("");
    const { data, error } = await supabase
      .from("script_presence")
      .select("*")
      .order("last_seen", { ascending: false });

    if (error) {
      setErr(error.message);
      setLoading(false);
      return;
    }
    setRows((data as Presence[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const active = useMemo(() => rows.filter((r) => isActive(r.last_seen)), [rows]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.username?.toLowerCase().includes(q) ||
        r.display_name?.toLowerCase().includes(q) ||
        String(r.user_id).includes(q) ||
        r.job_id?.toLowerCase().includes(q)
    );
  }, [rows, filter]);

  async function kick(userId: number, username: string) {
    if (!confirm(`Kick ${username} (${userId})?`)) return;
    setBusyId(userId);
    await supabase.from("remote_commands").insert({
      target_user_id: userId,
      command: "kick",
      args: { reason: "Kicked by mod panel" },
      consumed: false,
    });
    setBusyId(null);
    alert("Kick queued");
  }

  async function kill(userId: number, username: string) {
    if (!confirm(`Kill character of ${username}?`)) return;
    setBusyId(userId);
    await supabase.from("remote_commands").insert({
      target_user_id: userId,
      command: "kill",
      args: {},
      consumed: false,
    });
    setBusyId(null);
    alert("Kill queued");
  }

  async function tpTo(userId: number) {
    if (!selectedTarget) return;
    setTpPopup(false);
    setBusyId(selectedTarget);
    await supabase.from("remote_commands").insert({
      target_user_id: selectedTarget,
      command: "tp",
      args: { target_id: userId },
      consumed: false,
    });
    setBusyId(null);
    alert("TP queued");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tighter">Angoor Panel</h1>
            <p className="text-zinc-400 text-sm">Live script users • auto-refresh 5s</p>
          </div>
          <button onClick={load} className="rounded-2xl bg-white/10 hover:bg-white/20 px-6 py-3 text-sm backdrop-blur-xl">
            Refresh
          </button>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-3xl bg-white/5 border border-white/10 px-6 py-5">
            <div className="text-xs text-zinc-400">Active now</div>
            <div className="text-4xl font-semibold text-emerald-400">{active.length}</div>
          </div>
          <div className="rounded-3xl bg-white/5 border border-white/10 px-6 py-5">
            <div className="text-xs text-zinc-400">Tracked</div>
            <div className="text-4xl font-semibold">{rows.length}</div>
          </div>
          <div className="rounded-3xl bg-white/5 border border-white/10 px-6 py-5">
            <div className="text-xs text-zinc-400">Unique servers</div>
            <div className="text-4xl font-semibold">{new Set(rows.map(r => r.job_id)).size}</div>
          </div>
          <div className="rounded-3xl bg-white/5 border border-white/10 px-6 py-5">
            <div className="text-xs text-zinc-400">Script uptime</div>
            <div className="text-4xl font-semibold text-sky-400">—</div>
          </div>
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search username, id, job…"
          className="w-full rounded-3xl bg-white/5 border border-white/10 px-6 py-4 text-sm backdrop-blur-xl focus:outline-none focus:border-sky-500"
        />

        {err && <div className="rounded-3xl border border-red-900/50 bg-red-950/40 px-6 py-4 text-sm text-red-200">{err}</div>}

        {loading ? (
          <p className="text-zinc-500 text-sm">Loading...</p>
        ) : shown.length === 0 ? (
          <p className="text-zinc-500 text-sm">No users on the script. Run the script in game.</p>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/70">
                <tr>
                  <th className="px-6 py-4 text-left">Status</th>
                  <th className="px-6 py-4 text-left">User</th>
                  <th className="px-6 py-4 text-left">UserId</th>
                  <th className="px-6 py-4 text-left">Place</th>
                  <th className="px-6 py-4 text-left">Server</th>
                  <th className="px-6 py-4 text-left">Device</th>
                  <th className="px-6 py-4 text-left">Executor</th>
                  <th className="px-6 py-4 text-left">Last seen</th>
                  <th className="px-6 py-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const on = isActive(r.last_seen);
                  return (
                    <tr key={r.id} className="border-t border-white/10 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <div className={`inline-flex items-center gap-2 rounded-2xl px-3 py-1 text-xs font-medium backdrop-blur-xl ${on ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-zinc-400"}`}>
                          <div className={`h-2 w-2 rounded-full ${on ? "bg-emerald-400" : "bg-zinc-400"}`} />
                          {on ? "Active" : "Offline"}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <img src={`https://thumbnails.roblox.com/v1/users/avatar?userIds=${r.user_id}&size=48x48&format=png`} alt="" className="w-8 h-8 rounded-2xl" />
                          <div>
                            <div className="font-medium">{r.display_name || r.username}</div>
                            <div className="text-xs text-zinc-400">@{r.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs">{r.user_id}</td>
                      <td className="px-6 py-4">
                        {r.place_id && (
                          <a href={`https://www.roblox.com/games/${r.place_id}`} target="_blank" className="text-sky-400 hover:underline">
                            {r.place_id}
                          </a>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-zinc-400">{r.job_id}</td>
                      <td className="px-6 py-4 text-zinc-400">{r.device || "unknown"}</td>
                      <td className="px-6 py-4 text-zinc-400">{r.executor || "unknown"}</td>
                      <td className="px-6 py-4 text-zinc-400">{ago(r.last_seen)}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <button onClick={() => kick(r.user_id, r.username)} className="rounded-2xl bg-red-500/20 text-red-400 hover:bg-red-500/30 px-4 py-1 text-xs backdrop-blur-xl">
                            Kick
                          </button>
                          <button onClick={() => kill(r.user_id, r.username)} className="rounded-2xl bg-zinc-700 hover:bg-zinc-600 px-4 py-1 text-xs backdrop-blur-xl">
                            Kill
                          </button>
                          <button onClick={() => { setSelectedTarget(r.user_id); setTpPopup(true); }} className="rounded-2xl bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 px-4 py-1 text-xs backdrop-blur-xl">
                            TP
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* TP Popup */}
      {tpPopup && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-white/10 rounded-3xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Select player to TP to</h2>
            <div className="max-h-96 overflow-auto">
              {active.map((p) => (
                <button
                  key={p.user_id}
                  onClick={() => tpTo(p.user_id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-2xl text-left"
                >
                  <img src={`https://thumbnails.roblox.com/v1/users/avatar?userIds=${p.user_id}&size=32x32&format=png`} alt="" className="w-8 h-8 rounded-2xl" />
                  <div>
                    <div className="font-medium">{p.display_name || p.username}</div>
                    <div className="text-xs text-zinc-400">@{p.username}</div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setTpPopup(false)} className="mt-6 w-full py-3 text-sm text-zinc-400 hover:bg-white/5 rounded-2xl">
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}