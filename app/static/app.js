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

/* ---------- boot ---------- */

document.addEventListener("DOMContentLoaded", () => {
    initMetrics();
    // U3 and U4 init calls get added here
});