/* ============================================================
   TaskQueue Gateway dashboard
   Sections: helpers · metrics (U2) · rate limiter (U3) · jobs (U4)
   ============================================================ */

const $ = (id) => document.getElementById(id);

/* ---------- helpers ---------- */

function animateNumber(el, target, duration = 500) {
    const from = Number(el.dataset.value ?? 0);
    el.dataset.value = target;
    if (from === target) { el.textContent = target; return; }
    const start = performance.now();
    function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(from + (target - from) * eased);
        if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function fmtSeconds(v) {
    if (v === null || v === undefined) return "–";
    return v < 10 ? v.toFixed(2) + "s" : v.toFixed(1) + "s";
}

// Each browser gets its own rate-limit identity
const CLIENT_ID = (() => {
    try {
        let id = localStorage.getItem("tq-client");
        if (!id) {
            id = "dash-" + Math.random().toString(36).slice(2, 8);
            localStorage.setItem("tq-client", id);
        }
        return id;
    } catch {
        return "dash-" + Math.random().toString(36).slice(2, 8);
    }
})();

// fetch wrapper that always sends our client identity
function apiFetch(url, options = {}) {
    const headers = { "X-API-Key": CLIENT_ID, ...(options.headers || {}) };
    return fetch(url, { cache: "no-store", ...options, headers });
}

function toast(message, type = "info", ms = 3200) {
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = message;
    $("toasts").appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 300);
    }, ms);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- metrics (U2) ---------- */

const POLL_MS = 2000;
const MAX_POINTS = 60; // 60 points x 2s = 2 minutes
const LAT_KEYS = ["avg", "p50", "p95", "max"];

let queueChart = null;

function initChart() {
    Chart.defaults.color = "#8b90a7";
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";

    const ctx = $("queueChart").getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, "rgba(139, 92, 246, 0.45)");
    gradient.addColorStop(1, "rgba(139, 92, 246, 0)");

    queueChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: "#8b5cf6",
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 4,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            interaction: { intersect: false, mode: "index" },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (c) => ` ${c.parsed.y} jobs waiting` },
                },
            },
            scales: {
                x: { display: false },
                y: {
                    beginAtZero: true,
                    suggestedMax: 4,
                    ticks: { precision: 0, stepSize: 1 },
                    grid: { color: "rgba(255,255,255,0.06)" },
                    border: { display: false },
                },
            },
        },
    });
}

function pushChartPoint(depth) {
    const d = queueChart.data;
    d.labels.push(new Date().toLocaleTimeString());
    d.datasets[0].data.push(depth);
    if (d.labels.length > MAX_POINTS) {
        d.labels.shift();
        d.datasets[0].data.shift();
    }
    queueChart.update();
}

function buildLatency(containerId) {
    $(containerId).innerHTML = LAT_KEYS.map((k) => `
    <div class="lat-row">
      <span>${k}</span>
      <div class="bar"><i data-bar="${k}"></i></div>
      <b data-val="${k}">–</b>
    </div>`).join("");
}

function renderLatency(containerId, stats) {
    const box = $(containerId);
    const scale = Math.max(1, stats.max || 0);
    LAT_KEYS.forEach((k) => {
        const v = stats[k];
        box.querySelector(`[data-val="${k}"]`).textContent = fmtSeconds(v);
        const pct = v ? Math.min(100, (v / scale) * 100) : 0;
        box.querySelector(`[data-bar="${k}"]`).style.width = pct + "%";
    });
}

function setConnection(ok) {
    const pill = $("conn");
    pill.classList.toggle("ok", ok);
    pill.classList.toggle("bad", !ok);
    $("connText").textContent = ok ? "Live" : "API offline";
}

async function pollMetrics() {
    if (document.hidden) return; // don't poll in background tabs
    try {
        const res = await fetch("/metrics", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const m = await res.json();

        animateNumber($("kpiQueue"), m.queue_depth);
        animateNumber($("kpiCompleted"), m.tasks.completed);
        animateNumber($("kpiRetried"), m.tasks.retried);
        animateNumber($("kpiFailed"), m.tasks.failed);

        pushChartPoint(m.queue_depth);
        renderLatency("latWait", m.queue_wait_seconds);
        renderLatency("latRun", m.run_time_seconds);
        setConnection(true);
    } catch (err) {
        setConnection(false);
    }
}

function initMetrics() {
    initChart();
    buildLatency("latWait");
    buildLatency("latRun");
    pollMetrics();
    setInterval(pollMetrics, POLL_MS);
}

/* ---------- rate limiter (U3) ---------- */

const bucketState = { tokens: 0, capacity: 10, rate: 1, at: performance.now(), ready: false };
let bucketCells = [];

function buildBucket(capacity) {
    $("bucket").innerHTML = Array.from({ length: capacity }, () => "<div class='cell'><i></i></div>").join("");
    bucketCells = [...$("bucket").querySelectorAll(".cell i")];
}

function currentTokens() {
    const elapsed = (performance.now() - bucketState.at) / 1000;
    return Math.min(bucketState.capacity, bucketState.tokens + elapsed * bucketState.rate);
}

function renderBucket() {
    if (!bucketState.ready) return;
    const t = currentTokens();
    bucketCells.forEach((cell, i) => {
        cell.style.setProperty("--fill", Math.max(0, Math.min(1, t - i)));
    });
    $("tokenText").textContent = `${Math.floor(t)} / ${bucketState.capacity} tokens`;
}

async function syncBucket() {
    try {
        const res = await apiFetch("/rate-limit/status");
        const s = await res.json();
        if (!bucketState.ready || bucketState.capacity !== s.capacity) buildBucket(s.capacity);
        Object.assign(bucketState, {
            tokens: s.tokens,
            capacity: s.capacity,
            rate: s.refill_rate,
            at: performance.now(),
            ready: true,
        });
        $("clientId").textContent = s.client;
    } catch { /* the connection pill already shows API problems */ }
}

async function fireBurst() {
    const btn = $("burstBtn");
    const grid = $("burstGrid");
    btn.disabled = true;
    grid.innerHTML = "";
    $("burstSummary").textContent = "";
    let ok = 0, blocked = 0;

    for (let i = 1; i <= 15; i++) {
        let code = 0;
        try {
            const res = await apiFetch("/jobs/burst-test");
            code = res.status;
        } catch { code = 0; }

        const cell = document.createElement("div");
        const allowed = code === 200;
        cell.className = "burst-cell " + (allowed ? "ok" : "no");
        cell.textContent = allowed ? "✓" : code || "!";
        cell.title = `Request ${i}: HTTP ${code}`;
        grid.appendChild(cell);
        allowed ? ok++ : blocked++;

        // each request spent a token, so reflect that immediately
        if (allowed) {
            bucketState.tokens = Math.max(0, currentTokens() - 1);
            bucketState.at = performance.now();
        }
        await sleep(70);
    }

    $("burstSummary").textContent = `${ok} allowed · ${blocked} blocked (429)`;
    if (blocked) toast(`Rate limit hit: ${blocked} requests blocked`, "error");
    await syncBucket();
    btn.disabled = false;
}

function initRateLimiter() {
    $("clientId").textContent = CLIENT_ID;
    syncBucket();
    setInterval(syncBucket, 4000);   // re-sync with the server
    setInterval(renderBucket, 100);  // smooth local animation
    $("burstBtn").addEventListener("click", fireBurst);
}

/* ---------- jobs (U4) ---------- */

const PRESETS = {
    quick: { name: "quick-task", dur: 2, fail: 0 },
    heavy: { name: "heavy-report", dur: 20, fail: 0 },
    flaky: { name: "flaky-sync", dur: 3, fail: 60 },
    doomed: { name: "doomed-job", dur: 2, fail: 100 },
};

const STATUS_MAP = {
    PENDING: "queued",
    STARTED: "running",
    RETRY: "retrying",
    SUCCESS: "success",
    FAILURE: "failed",
};
const STATUS_LABEL = {
    queued: "Queued", running: "Running", retrying: "Retrying", success: "Done", failed: "Failed",
};

const jobs = []; // newest first

function syncSliderLabels() {
    $("durOut").textContent = $("jobDur").value + "s";
    $("failOut").textContent = $("jobFail").value + "%";
}

function applyPreset(key) {
    const p = PRESETS[key];
    $("jobName").value = p.name;
    $("jobDur").value = p.dur;
    $("jobFail").value = p.fail;
    syncSliderLabels();
}

function createJobElement(job) {
    const li = document.createElement("li");
    li.className = "job queued";
    li.innerHTML = `
    <div class="job-name">
      <b></b><code>${job.id.slice(0, 8)}</code>
    </div>
    <div class="job-side">
      <span class="time">0s</span>
      <span class="badge">Queued</span>
    </div>
    <div class="bar"><i></i></div>`;
    li.querySelector("b").textContent = job.name;
    return li;
}

function addJob(id, name, duration) {
    const job = {
        id, name, duration,
        ui: "queued",
        submittedAt: performance.now(),
        startedAt: null,
        finishedAt: null,
        attempts: null,
    };
    job.el = createJobElement(job);
    jobs.unshift(job);
    $("jobList").prepend(job.el);
    $("jobsEmpty").hidden = true;
}

function renderJob(job) {
    const el = job.el;
    const now = performance.now();

    el.className = "job " + job.ui;
    const badge = el.querySelector(".badge");
    badge.textContent = STATUS_LABEL[job.ui] +
        (job.ui === "success" && job.attempts > 1 ? ` · ${job.attempts} tries` : "");

    const end = job.finishedAt ?? now;
    el.querySelector(".time").textContent = ((end - job.submittedAt) / 1000).toFixed(0) + "s";

    let pct = 0;
    if (job.ui === "queued") pct = 4;
    else if (job.ui === "running") {
        const elapsed = (now - (job.startedAt ?? now)) / 1000;
        pct = Math.min(95, (elapsed / job.duration) * 100);
    } else pct = 100; // retrying, success, failed
    el.querySelector(".bar i").style.width = pct + "%";
}

function updateJobStatus(job, data) {
    const next = STATUS_MAP[data.status] ?? "queued";
    if (next === job.ui) return;

    job.ui = next;
    if (next === "running") job.startedAt = performance.now();

    if (next === "success" || next === "failed") {
        job.finishedAt = performance.now();
        if (next === "success") {
            job.attempts = data.result?.attempts ?? 1;
            toast(`${job.name} completed`, "success");
        } else {
            toast(`${job.name} failed after retries`, "error");
        }
    }
}

async function pollJobs() {
    const active = jobs.filter((j) => j.ui !== "success" && j.ui !== "failed");
    if (!active.length || document.hidden) return;
    try {
        const ids = active.map((j) => j.id).join(",");
        const res = await fetch("/dashboard/jobs?ids=" + encodeURIComponent(ids), { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        active.forEach((j) => data[j.id] && updateJobStatus(j, data[j.id]));
    } catch { /* connection pill covers this */ }
}

async function submitJob(name, duration, failPct) {
    const res = await apiFetch("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_name: name, duration, fail_rate: failPct / 100 }),
    });

    if (res.status === 429) {
        const wait = res.headers.get("Retry-After") || "a few";
        toast(`Rate limited. Try again in ${wait}s`, "error");
        return false;
    }
    if (!res.ok) {
        toast("Could not queue job (HTTP " + res.status + ")", "error");
        return false;
    }
    const data = await res.json();
    addJob(data.job_id, name, duration);
    return true;
}

async function onSubmit(e) {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try {
        const ok = await submitJob(
            $("jobName").value.trim() || "untitled",
            Number($("jobDur").value),
            Number($("jobFail").value),
        );
        if (ok) { toast("Job queued", "info"); syncBucket(); }
    } catch {
        toast("API unreachable", "error");
    }
    btn.disabled = false;
}

async function queueFive() {
    const btn = $("loadBtn");
    btn.disabled = true;
    const name = $("jobName").value.trim() || "batch";
    const dur = Number($("jobDur").value);
    const fail = Number($("jobFail").value);
    try {
        for (let i = 1; i <= 5; i++) {
            const ok = await submitJob(`${name} #${i}`, dur, fail);
            if (!ok) break;
            await sleep(80);
        }
    } catch {
        toast("API unreachable", "error");
    }
    syncBucket();
    btn.disabled = false;
}

function clearFinished() {
    for (let i = jobs.length - 1; i >= 0; i--) {
        if (jobs[i].ui === "success" || jobs[i].ui === "failed") {
            jobs[i].el.remove();
            jobs.splice(i, 1);
        }
    }
    $("jobsEmpty").hidden = jobs.length > 0;
}

function initJobs() {
    syncSliderLabels();
    $("jobDur").addEventListener("input", syncSliderLabels);
    $("jobFail").addEventListener("input", syncSliderLabels);
    document.querySelectorAll(".chip").forEach((c) =>
        c.addEventListener("click", () => applyPreset(c.dataset.preset)));
    $("jobForm").addEventListener("submit", onSubmit);
    $("loadBtn").addEventListener("click", queueFive);
    $("clearBtn").addEventListener("click", clearFinished);

    setInterval(pollJobs, 1000);                       // ask the server
    setInterval(() => jobs.forEach(renderJob), 250);   // smooth local progress
}

/* ---------- boot ---------- */

document.addEventListener("DOMContentLoaded", () => {
    initMetrics();
    initRateLimiter();
    initJobs();
    // U4 init call gets added here
});