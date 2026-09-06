"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Presence = {
  id?: number;
  user_id: number;
  username: string;
  display_name: string | null;
  job_id: string;
  place_id: number | null;
  last_seen: string;
  device?: string | null;
};

const STALE_MS = 45_000; // active if seen within 45s

function isActive(lastSeen: string) {
  return Date.now() - new Date(lastSeen).getTime() < STALE_MS;
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
  const inactive = useMemo(() => rows.filter((r) => !isActive(r.last_seen)), [rows]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = rows;
    if (!q) return list;
    return list.filter(
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
    const { error } = await supabase.from("remote_commands").insert({
      target_user_id: userId,
      command: "kick",
      args: { reason: "Kicked by mod panel" },
      consumed: false,
    });
    setBusyId(null);
    if (error) alert("Kick failed: " + error.message);
    else alert("Kick queued — their script will pick it up in a few seconds.");
  }

  async function kill(userId: number, username: string) {
    if (!confirm(`Kill character of ${username}?`)) return;
    setBusyId(userId);
    const { error } = await supabase.from("remote_commands").insert({
      target_user_id: userId,
      command: "kill",
      args: {},
      consumed: false,
    });
    setBusyId(null);
    if (error) alert("Kill failed: " + error.message);
    else alert("Kill queued.");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Angoor Panel</h1>
            <p className="text-zinc-400 text-sm">Live script users · auto-refresh 5s</p>
          </div>
          <button
            onClick={load}
            className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-sm"
          >
            Refresh
          </button>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Active now" value={active.length} accent />
          <Stat label="Tracked rows" value={rows.length} />
          <Stat label="Inactive" value={inactive.length} />
          <Stat label="Unique jobs" value={new Set(rows.map((r) => r.job_id)).size} />
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search username, id, job…"
          className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm outline-none focus:border-zinc-600"
        />

        {err && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {err}
          </div>
        )}

        {loading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-zinc-500 text-sm">No presence rows. Execute the script in-game.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-left">
                <tr>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">User</th>
                  <th className="px-3 py-3">UserId</th>
                  <th className="px-3 py-3">Place</th>
                  <th className="px-3 py-3">Server (JobId)</th>
                  <th className="px-3 py-3">Device</th>
                  <th className="px-3 py-3">Last seen</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const on = isActive(r.last_seen);
                  return (
                    <tr key={`${r.user_id}-${r.job_id}`} className="border-t border-zinc-900">
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${
                            on ? "bg-emerald-950 text-emerald-300" : "bg-zinc-900 text-zinc-500"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-zinc-600"}`} />
                          {on ? "Active" : "Offline"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium">{r.display_name || r.username}</div>
                        <div className="text-zinc-500 text-xs">@{r.username}</div>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">{r.user_id}</td>
                      <td className="px-3 py-3">
                        {r.place_id ? (
                          <a
                            className="text-sky-400 hover:underline"
                            href={`https://www.roblox.com/games/${r.place_id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {r.place_id}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-zinc-400 max-w-[140px] truncate" title={r.job_id}>
                        {r.job_id}
                      </td>
                      <td className="px-3 py-3 text-zinc-400">{r.device || "unknown"}</td>
                      <td className="px-3 py-3 text-zinc-400">{ago(r.last_seen)}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button
                            disabled={busyId === r.user_id}
                            onClick={() => kick(r.user_id, r.username)}
                            className="rounded-md bg-red-950 text-red-300 hover:bg-red-900 px-2 py-1 text-xs disabled:opacity-50"
                          >
                            Kick
                          </button>
                          <button
                            disabled={busyId === r.user_id}
                            onClick={() => kill(r.user_id, r.username)}
                            className="rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 px-2 py-1 text-xs disabled:opacity-50"
                          >
                            Kill
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

        <p className="text-xs text-zinc-600">
          Share this Vercel URL with mods. Kick/Kill only work if their Angoor script is running and polling commands.
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold ${accent ? "text-emerald-400" : ""}`}>{value}</div>
    </div>
  );
}