"use client";

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
  country?: string | null;
  country_code?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  session_started_at?: string | null;
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

function playTime(startedAt: string | null | undefined, lastSeen: string) {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = isActive(lastSeen) ? Date.now() : new Date(lastSeen).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";

  const total = Math.floor((end - start) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function cleanText(v: string | null | undefined) {
  const s = (v || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "unknown" || lower === "null" || lower === "undefined" || lower === "n/a") {
    return "";
  }
  return s;
}

function deviceText(r: Presence) {
  return cleanText(r.device) || "—";
}

function executorText(r: Presence) {
  return cleanText(r.executor) || "—";
}

function locationText(r: Presence) {
  const city = cleanText(r.city);
  const country = cleanText(r.country);
  const code = cleanText(r.country_code);
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  if (code) return code;
  if (r.latitude != null && r.longitude != null) {
    return `${Number(r.latitude).toFixed(2)}, ${Number(r.longitude).toFixed(2)}`;
  }
  return "—";
}

function headshot(userId: number) {
  return `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;
}

export default function Page() {
  const [rows, setRows] = useState<Presence[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tpPopup, setTpPopup] = useState(false);
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

    // One row per user_id — newest last_seen wins (query is newest → oldest)
    const newestByUser = new Map<number, Presence>();
    for (const row of (data as Presence[]) || []) {
      if (!newestByUser.has(row.user_id)) {
        newestByUser.set(row.user_id, row);
      }
    }

    const list = Array.from(newestByUser.values()).sort((a, b) => {
      const ao = isActive(a.last_seen) ? 1 : 0;
      const bo = isActive(b.last_seen) ? 1 : 0;
      if (ao !== bo) return bo - ao;
      return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
    });

    setRows(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
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
        r.job_id?.toLowerCase().includes(q) ||
        r.device?.toLowerCase().includes(q) ||
        r.executor?.toLowerCase().includes(q) ||
        r.country?.toLowerCase().includes(q) ||
        r.city?.toLowerCase().includes(q)
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
    if (error) {
      alert(error.message);
      return;
    }
    alert("Kick queued");
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
    if (error) {
      alert(error.message);
      return;
    }
    alert("Kill queued");
  }

  async function tpTo(targetUserId: number) {
    if (!selectedTarget) return;
    const target = rows.find((r) => r.user_id === selectedTarget);
    const destination = rows.find((r) => r.user_id === targetUserId);
    if (!target || !destination) return;

    if (target.job_id !== destination.job_id) {
      alert("That player is not in the same server.");
      return;
    }

    setTpPopup(false);
    setBusyId(selectedTarget);

    const { error } = await supabase.from("remote_commands").insert({
      target_user_id: selectedTarget,
      command: "tp",
      args: {
        target_id: targetUserId,
        to_user_id: targetUserId,
        to_username: destination.username,
        target_job_id: destination.job_id,
      },
      consumed: false,
    });

    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    alert("TP queued");
  }

  const selectedPlayer = selectedTarget
    ? rows.find((r) => r.user_id === selectedTarget)
    : null;

  const sameServerPlayers = selectedPlayer
    ? active.filter(
        (p) =>
          p.user_id !== selectedPlayer.user_id &&
          p.job_id === selectedPlayer.job_id
      )
    : [];

  return (
    <main className="min-h-screen bg-[#07090d] text-zinc-100 p-6 font-sans">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Angoor Panel</h1>
            <p className="text-zinc-400 text-sm">
              One live presence per Roblox user • auto-refresh 5s
            </p>
          </div>

          <button
            onClick={load}
            className="rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 px-6 py-3 text-sm transition"
          >
            Refresh
          </button>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-3xl bg-white/5 border border-white/10 px-6 py-5 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Active now</div>
            <div className="text-4xl font-semibold text-emerald-400">{active.length}</div>
          </div>
          <div className="rounded-3xl bg-white/5 border border-white/10 px-6 py-5 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Unique players</div>
            <div className="text-4xl font-semibold">{rows.length}</div>
          </div>
          <div className="rounded-3xl bg-white/5 border border-white/10 px-6 py-5 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Unique servers</div>
            <div className="text-4xl font-semibold">
              {new Set(rows.map((r) => r.job_id).filter(Boolean)).size}
            </div>
          </div>
          <div className="rounded-3xl bg-white/5 border border-white/10 px-6 py-5 backdrop-blur-xl">
            <div className="text-xs text-zinc-400">Refresh</div>
            <div className="text-4xl font-semibold text-sky-400">5s</div>
          </div>
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search username, ID, server, device, executor, city…"
          className="w-full rounded-3xl bg-white/5 border border-white/10 px-6 py-4 text-sm backdrop-blur-xl focus:outline-none focus:border-sky-500/60"
        />

        {err && (
          <div className="rounded-3xl border border-red-900/50 bg-red-950/40 px-6 py-4 text-sm text-red-200">
            {err}
          </div>
        )}

        {loading ? (
          <p className="text-zinc-500 text-sm">Loading...</p>
        ) : shown.length === 0 ? (
          <p className="text-zinc-500 text-sm">No users on the script. Run the script in game.</p>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-white/10 bg-black/20 backdrop-blur-xl">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/70">
                <tr>
                  <th className="px-6 py-4 text-left">Status</th>
                  <th className="px-6 py-4 text-left">User</th>
                  <th className="px-6 py-4 text-left">Place</th>
                  <th className="px-6 py-4 text-left">Server</th>
                  <th className="px-6 py-4 text-left">Device</th>
                  <th className="px-6 py-4 text-left">Location</th>
                  <th className="px-6 py-4 text-left">Play time</th>
                  <th className="px-6 py-4 text-left">Executor</th>
                  <th className="px-6 py-4 text-left">Last seen</th>
                  <th className="px-6 py-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const on = isActive(r.last_seen);
                  const busy = busyId === r.user_id;

                  return (
                    <tr
                      key={r.user_id}
                      className="border-t border-white/10 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div
                          className={`inline-flex items-center gap-2 rounded-2xl px-3 py-1 text-xs font-medium ${
                            on
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-white/5 text-zinc-400"
                          }`}
                        >
                          <div
                            className={`h-2 w-2 rounded-full ${
                              on ? "bg-emerald-400" : "bg-zinc-500"
                            }`}
                          />
                          {on ? "Online" : "Offline"}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={headshot(r.user_id)}
                            alt=""
                            className="w-9 h-9 rounded-2xl object-cover bg-zinc-800"
                          />
                          <div>
                            <div className="font-medium">{r.display_name || r.username}</div>
                            <div className="text-xs text-zinc-400">
                              @{r.username} • {r.user_id}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        {r.place_id ? (
                          <a
                            href={`https://www.roblox.com/games/${r.place_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-400 hover:underline"
                          >
                            {r.place_id}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="px-6 py-4 font-mono text-xs text-zinc-400 max-w-32 truncate">
                        {r.job_id || "—"}
                      </td>

                      <td className="px-6 py-4 text-zinc-300">{deviceText(r)}</td>

                      <td className="px-6 py-4 text-zinc-400">
                        <div>{locationText(r)}</div>
                        {cleanText(r.country_code) && (
                          <div className="text-xs text-zinc-600">{r.country_code}</div>
                        )}
                      </td>

                      <td className="px-6 py-4 text-zinc-300">
                        {playTime(r.session_started_at, r.last_seen)}
                      </td>

                      <td className="px-6 py-4 text-zinc-400">{executorText(r)}</td>

                      <td className="px-6 py-4 text-zinc-400 whitespace-nowrap">
                        {ago(r.last_seen)}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <button
                            disabled={busy || !on}
                            onClick={() => kick(r.user_id, r.username)}
                            className="rounded-2xl bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 text-xs transition"
                          >
                            Kick
                          </button>
                          <button
                            disabled={busy || !on}
                            onClick={() => kill(r.user_id, r.username)}
                            className="rounded-2xl bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 text-xs transition"
                          >
                            Kill
                          </button>
                          <button
                            disabled={!on || busy}
                            onClick={() => {
                              setSelectedTarget(r.user_id);
                              setTpPopup(true);
                            }}
                            className="rounded-2xl bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-1.5 text-xs transition"
                          >
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

      {tpPopup && selectedPlayer && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4"
          onClick={() => setTpPopup(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-[#0d1117]/95 border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-xl font-semibold">TP {selectedPlayer.username}</h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Select an active player in the same server
                </p>
              </div>
              <button
                onClick={() => setTpPopup(false)}
                className="w-9 h-9 rounded-2xl bg-white/5 hover:bg-white/10 text-zinc-400 transition"
              >
                ×
              </button>
            </div>

            {sameServerPlayers.length === 0 ? (
              <div className="rounded-2xl bg-white/5 border border-white/10 p-5 text-sm text-zinc-400 text-center">
                No other active players are in this server.
              </div>
            ) : (
              <div className="max-h-96 overflow-auto space-y-2">
                {sameServerPlayers.map((p) => (
                  <button
                    key={p.user_id}
                    onClick={() => tpTo(p.user_id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-2xl text-left transition"
                  >
                    <img
                      src={headshot(p.user_id)}
                      alt=""
                      className="w-9 h-9 rounded-2xl object-cover bg-zinc-800"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{p.display_name || p.username}</div>
                      <div className="text-xs text-zinc-500">@{p.username} • Online</div>
                    </div>
                    <span className="text-xs text-sky-400">TP →</span>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => setTpPopup(false)}
              className="mt-5 w-full py-3 text-sm text-zinc-400 hover:bg-white/5 rounded-2xl transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
