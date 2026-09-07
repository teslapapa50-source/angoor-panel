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

  // These fields are optional so the page still works with the current table.
  country?: string | null;
  country_code?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  session_started_at?: string | null;
  started_at?: string | null;
  play_time?: number | null;
};

function isActive(lastSeen: string) {
  return Date.now() - new Date(lastSeen).getTime() < 45000;
}

function ago(lastSeen: string) {
  const s = Math.max(
    0,
    Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000)
  );

  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));

  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function getPlayTime(row: Presence, now: number) {
  if (typeof row.play_time === "number") return row.play_time;

  const started = row.session_started_at || row.started_at;
  if (started) {
    return Math.max(
      0,
      Math.floor((now - new Date(started).getTime()) / 1000)
    );
  }

  return 0;
}

function deviceLabel(device: string | null) {
  if (!device) return "Unknown";

  const d = device.toLowerCase();

  if (d.includes("phone") || d.includes("mobile") || d.includes("android") || d.includes("ios")) {
    return "Mobile";
  }

  if (d.includes("tablet") || d.includes("ipad")) return "Tablet";
  if (d.includes("console") || d.includes("xbox") || d.includes("playstation")) {
    return "Console";
  }

  return "PC";
}

function DeviceIcon({ device }: { device: string | null }) {
  const label = deviceLabel(device);

  if (label === "Mobile") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="7" y="2.5" width="10" height="19" rx="2" />
        <path d="M10 5h4M11 18.5h2" />
      </svg>
    );
  }

  if (label === "Tablet") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="2.5" width="16" height="19" rx="2" />
        <path d="M10 5h4M11 18.5h2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4M7 20h10" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.4 2.5 3.5 5.5 3.5 9s-1.1 6.5-3.5 9c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3Z" />
    </svg>
  );
}

function locationText(row: Presence) {
  const parts = [row.city, row.country].filter(Boolean);
  if (parts.length) return parts.join(", ");
  if (row.country_code) return row.country_code.toUpperCase();
  return "Location unavailable";
}

export default function Page() {
  const [rows, setRows] = useState<Presence[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tpPopup, setTpPopup] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<Presence | null>(null);
  const [now, setNow] = useState(Date.now());

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

    const refresh = setInterval(load, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load]);

  const active = useMemo(
    () => rows.filter((r) => isActive(r.last_seen)),
    [rows, now]
  );

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();

    if (!q) return rows;

    return rows.filter(
      (r) =>
        r.username?.toLowerCase().includes(q) ||
        r.display_name?.toLowerCase().includes(q) ||
        String(r.user_id).includes(q) ||
        r.job_id?.toLowerCase().includes(q) ||
        locationText(r).toLowerCase().includes(q) ||
        deviceLabel(r.device).toLowerCase().includes(q)
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

    if (error) alert(error.message);
    else alert("Kick queued");
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

    if (error) alert(error.message);
    else alert("Kill queued");
  }

  function openTp(row: Presence) {
    setSelectedTarget(row);
    setTpPopup(true);
  }

  async function tpTo(targetPlayer: Presence) {
    if (!selectedTarget) return;

    setTpPopup(false);
    setBusyId(selectedTarget.user_id);

    const { error } = await supabase.from("remote_commands").insert({
      target_user_id: selectedTarget.user_id,
      command: "tp",
      args: {
        target_id: targetPlayer.user_id,
        target_job_id: targetPlayer.job_id,
      },
      consumed: false,
    });

    setBusyId(null);

    if (error) alert(error.message);
    else alert(`TP queued: ${selectedTarget.username} → ${targetPlayer.username}`);
  }

  const sameServerTargets = useMemo(() => {
    if (!selectedTarget) return [];

    return active.filter(
      (p) =>
        p.job_id === selectedTarget.job_id &&
        p.user_id !== selectedTarget.user_id
    );
  }, [active, selectedTarget]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#060914] text-zinc-100">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-sky-500/10 blur-[110px]" />
        <div className="absolute -right-32 top-1/3 h-[500px] w-[500px] rounded-full bg-violet-500/10 blur-[130px]" />
        <div className="absolute bottom-[-220px] left-1/3 h-[500px] w-[500px] rounded-full bg-emerald-500/5 blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.045),transparent_35%)]" />
      </div>

      <div className="mx-auto max-w-[1500px] space-y-6 p-5 sm:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]" />
              <span className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-300/80">
                Live monitoring
              </span>
            </div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em]">
              Angoor Panel
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Script sessions, devices, locations and server activity
            </p>
          </div>

          <button
            onClick={load}
            className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-medium backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/[0.1] active:translate-y-0"
          >
            Refresh
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/10 backdrop-blur-2xl">
            <div className="text-xs text-zinc-500">Active now</div>
            <div className="mt-2 text-4xl font-semibold text-emerald-400">{active.length}</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/10 backdrop-blur-2xl">
            <div className="text-xs text-zinc-500">Script sessions</div>
            <div className="mt-2 text-4xl font-semibold">{rows.length}</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/10 backdrop-blur-2xl">
            <div className="text-xs text-zinc-500">Unique servers</div>
            <div className="mt-2 text-4xl font-semibold text-sky-400">
              {new Set(rows.map((r) => r.job_id)).size}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/10 backdrop-blur-2xl">
            <div className="text-xs text-zinc-500">Unique players</div>
            <div className="mt-2 text-4xl font-semibold text-violet-400">
              {new Set(rows.map((r) => r.user_id)).size}
            </div>
          </div>
        </div>

        <div className="relative">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search player, ID, server, device or location…"
            className="w-full rounded-3xl border border-white/10 bg-white/[0.045] px-6 py-4 text-sm outline-none backdrop-blur-2xl transition placeholder:text-zinc-600 focus:border-sky-400/50 focus:bg-white/[0.065]"
          />
        </div>

        {err && (
          <div className="rounded-3xl border border-red-500/20 bg-red-500/10 px-6 py-4 text-sm text-red-200">
            {err}
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-10 text-center text-sm text-zinc-500">
            Loading sessions…
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-10 text-center text-sm text-zinc-500">
            No script sessions found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/20 shadow-2xl shadow-black/20 backdrop-blur-2xl">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1250px] text-sm">
                <thead className="border-b border-white/10 bg-white/[0.045] text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-5 py-4 text-left">Status</th>
                    <th className="px-5 py-4 text-left">Player</th>
                    <th className="px-5 py-4 text-left">Device</th>
                    <th className="px-5 py-4 text-left">Location</th>
                    <th className="px-5 py-4 text-left">Play time</th>
                    <th className="px-5 py-4 text-left">Place</th>
                    <th className="px-5 py-4 text-left">Server</th>
                    <th className="px-5 py-4 text-left">Executor</th>
                    <th className="px-5 py-4 text-left">Last seen</th>
                    <th className="px-5 py-4 text-left">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {shown.map((r, index) => {
                    const on = isActive(r.last_seen);
                    const sameUserCount = rows.filter((x) => x.user_id === r.user_id).length;
                    const playTime = getPlayTime(r, now);

                    return (
                      <tr
                        key={r.id ?? `${r.user_id}-${r.last_seen}-${index}`}
                        className="border-t border-white/[0.06] transition hover:bg-white/[0.035]"
                      >
                        <td className="px-5 py-4">
                          <div
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                              on
                                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                                : "border-white/10 bg-white/[0.04] text-zinc-500"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                on
                                  ? "animate-pulse bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]"
                                  : "bg-zinc-600"
                              }`}
                            />
                            {on ? "Active" : "Offline"}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={`https://thumbnails.roblox.com/v1/users/avatar?userIds=${r.user_id}&size=48x48&format=png`}
                              alt=""
                              className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5"
                            />
                            <div>
                              <div className="flex items-center gap-2 font-medium">
                                {r.display_name || r.username}
                                {sameUserCount > 1 && (
                                  <span className="rounded-full bg-violet-400/10 px-2 py-0.5 text-[10px] text-violet-300">
                                    {sameUserCount} sessions
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-xs text-zinc-500">
                                @{r.username} · {r.user_id}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2 text-zinc-300">
                            <span className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-zinc-400">
                              <DeviceIcon device={r.device} />
                            </span>
                            <div>
                              <div>{deviceLabel(r.device)}</div>
                              <div className="text-xs text-zinc-600">{r.device || "unknown"}</div>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <span className="rounded-xl border border-sky-400/10 bg-sky-400/10 p-2 text-sky-300">
                              <GlobeIcon />
                            </span>
                            <div>
                              <div className="text-zinc-300">{locationText(r)}</div>
                              {r.latitude != null && r.longitude != null ? (
                                <div className="text-xs text-zinc-600">
                                  {r.latitude.toFixed(3)}, {r.longitude.toFixed(3)}
                                </div>
                              ) : (
                                <div className="text-xs text-zinc-600">
                                  Add geo data to presence
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="font-mono text-xs text-zinc-300">
                            {playTime ? duration(playTime) : "—"}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          {r.place_id ? (
                            <a
                              href={`https://www.roblox.com/games/${r.place_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-300 transition hover:text-sky-200 hover:underline"
                            >
                              {r.place_id}
                            </a>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>

                        <td className="max-w-[180px] px-5 py-4">
                          <div className="truncate font-mono text-xs text-zinc-500" title={r.job_id}>
                            {r.job_id}
                          </div>
                        </td>

                        <td className="px-5 py-4 text-zinc-500">
                          {r.executor || "unknown"}
                        </td>

                        <td className="px-5 py-4 whitespace-nowrap text-zinc-500">
                          {ago(r.last_seen)}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex gap-2">
                            <button
                              disabled={busyId === r.user_id}
                              onClick={() => kick(r.user_id, r.username)}
                              className="rounded-xl border border-red-400/10 bg-red-400/10 px-3 py-2 text-xs text-red-300 transition hover:bg-red-400/20 disabled:cursor-wait disabled:opacity-50"
                            >
                              Kick
                            </button>

                            <button
                              disabled={busyId === r.user_id}
                              onClick={() => kill(r.user_id, r.username)}
                              className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"
                            >
                              Kill
                            </button>

                            <button
                              disabled={!on || busyId === r.user_id}
                              onClick={() => openTp(r)}
                              className="rounded-xl border border-sky-400/10 bg-sky-400/10 px-3 py-2 text-xs text-sky-300 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-40"
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
          </div>
        )}
      </div>

      {/* Smooth TP modal */}
      {tpPopup && selectedTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-[fadeIn_180ms_ease-out]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTpPopup(false);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1020]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl animate-[modalIn_220ms_cubic-bezier(.16,1,.3,1)]">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <div className="text-lg font-semibold">Teleport player</div>
                <div className="mt-1 text-xs text-zinc-500">
                  Select an active player in the same server
                </div>
              </div>

              <button
                onClick={() => setTpPopup(false)}
                className="rounded-xl bg-white/[0.05] px-3 py-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4">
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-sky-400/10 bg-sky-400/[0.06] p-3">
                <img
                  src={`https://thumbnails.roblox.com/v1/users/avatar?userIds=${selectedTarget.user_id}&size=48x48&format=png`}
                  alt=""
                  className="h-9 w-9 rounded-xl"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {selectedTarget.display_name || selectedTarget.username}
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    Server: {selectedTarget.job_id}
                  </div>
                </div>
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {sameServerTargets.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
                    <div className="text-sm text-zinc-400">
                      No other active players found.
                    </div>
                    <div className="mt-1 text-xs text-zinc-600">
                      The target must be active in the same JobId.
                    </div>
                  </div>
                ) : (
                  sameServerTargets.map((p) => (
                    <button
                      key={`${p.user_id}-${p.id ?? p.last_seen}`}
                      onClick={() => tpTo(p)}
                      className="group flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-sky-400/10 hover:bg-sky-400/[0.07]"
                    >
                      <img
                        src={`https://thumbnails.roblox.com/v1/users/avatar?userIds=${p.user_id}&size=48x48&format=png`}
                        alt=""
                        className="h-9 w-9 rounded-xl border border-white/10"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {p.display_name || p.username}
                        </div>
                        <div className="truncate text-xs text-zinc-500">
                          @{p.username} · {deviceLabel(p.device)}
                        </div>
                      </div>

                      <span className="rounded-xl bg-sky-400/10 px-3 py-1.5 text-xs text-sky-300 opacity-70 transition group-hover:opacity-100">
                        TP →
                      </span>
                    </button>
                  ))
                )}
              </div>

              <button
                onClick={() => setTpPopup(false)}
                className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3 text-sm text-zinc-400 transition hover:bg-white/[0.08] hover:text-zinc-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes modalIn {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </main>
  );
}
