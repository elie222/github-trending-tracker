(function () {
  const state = { list: "typescript", range: "all", hover: null, heat: null };
  let data = null;
  let chart = null;
  let heat = null;
  let heatScrolled = false;

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null) continue;
        if (key === "class") node.className = value;
        else node.setAttribute(key, String(value));
      }
    }
    for (const child of children || []) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  }

  function svg(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value != null) node.setAttribute(key, String(value));
    }
    return node;
  }

  function fmt(iso, options) {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...options });
  }

  function listLabel() {
    return state.list === "typescript" ? "TypeScript" : "All languages";
  }

  function field() {
    return state.list === "typescript" ? "ts" : "all";
  }

  function knownKey() {
    return state.list === "typescript" ? "tsKnown" : "allKnown";
  }

  function repoKey() {
    return state.list === "typescript" ? "tsRepo" : "allRepo";
  }

  function summary() {
    return data.summary[field()];
  }

  function rankAt(day) {
    if (!day[knownKey()]) return { kind: "unknown" };
    const rank = day[field()];
    if (rank == null) return { kind: "off" };
    return { kind: "rank", rank };
  }

  function visibleDays() {
    const n = { "30d": 30, "90d": 90, "1y": 365 }[state.range] || data.days.length;
    return data.days.slice(-n);
  }

  function ago(iso) {
    const then = Date.parse(iso);
    if (!iso || Number.isNaN(then)) return "unknown";
    const abs = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(then)) + " UTC";
    const seconds = Math.max(0, (Date.now() - then) / 1000);
    let rel = "just now";
    if (seconds >= 86400) rel = Math.floor(seconds / 86400) + "d ago";
    else if (seconds >= 3600) rel = Math.floor(seconds / 3600) + "h ago";
    else if (seconds >= 60) rel = Math.floor(seconds / 60) + "m ago";
    return rel + " · " + abs;
  }

  function renderUpdated() {
    const node = $("updated");
    if (!data.updatedAt) {
      node.textContent = "unknown";
      return;
    }
    node.dateTime = data.updatedAt;
    node.textContent = ago(data.updatedAt);
  }

  function renderIdentity() {
    const who = $("hero-who");
    who.replaceChildren(
      document.createTextNode(data.developer.name + " · "),
      el("a", { href: data.developer.url }, ["@" + data.developer.login]),
    );
    $("source-link").href = data.repositoryUrl;
    $("heat-title").textContent = "Every day since " + data.sinceShort;
  }

  function renderHero() {
    const ts = data.summary.ts;
    const body = $("hero-body");
    const title = el("h1", null, [
      el("span", { class: "hash" }, ["#1"]),
      " on GitHub Trending (TypeScript) on " + ts.daysAtOne + " " + (ts.daysAtOne === 1 ? "day" : "days") + ".",
    ]);
    const sub = el("p", { class: "hero-sub" }, [
      el("strong", null, [String(ts.onList)]),
      " days on the list · ",
      el("strong", null, [String(ts.top10)]),
      " in the top 10 · since " + data.sinceLabel,
    ]);
    body.replaceChildren(title, sub);
  }

  function renderToday() {
    const ts = data.summary.ts;
    const label = !ts.todayKnown ? "—" : ts.today == null ? "Off list" : "#" + ts.today;
    $("today-rank").textContent = label;
    $("live").hidden = false;
    $("live-wait").hidden = true;
  }

  function renderCards() {
    const stats = summary();
    const cards = [
      { label: "At #1", value: stats.daysAtOne, unit: "days", dot: "#D8A40C" },
      { label: "In the top 10", value: stats.top10, unit: "days", dot: "#2563EB" },
      { label: "On the list", value: stats.onList, unit: "days", dot: "#C3DEFC" },
      { label: "Longest #1 streak", value: stats.longestOneStreak, unit: "days", dot: "transparent" },
      { label: "Longest on-list streak", value: stats.longestOnListStreak, unit: "days", dot: "transparent" },
      {
        label: "Current streak",
        value: stats.currentStreak,
        unit: stats.currentStreak === 1 ? "day" : "days",
        dot: stats.currentStreak ? "#17A34A" : "transparent",
      },
    ];
    $("cards").replaceChildren(
      ...cards.map((card) =>
        el("div", { class: "card" }, [
          el("span", { class: "card-label" }, [el("span", { class: "card-dot", style: "background:" + card.dot }), card.label]),
          el("div", { class: "card-value" }, [el("strong", null, [String(card.value)]), el("span", null, [card.unit])]),
        ]),
      ),
    );
    $("record-label").textContent = listLabel() + " developers list";
  }

  function renderRepos() {
    const mount = $("repo-list");
    if (!data.repos.length) {
      mount.replaceChildren(el("p", { class: "muted" }, ["No repository appearances yet."]));
      return;
    }
    mount.replaceChildren(
      ...data.repos.map((repo) => {
        const copy = [el("span", { class: "repo-name" }, [repo.fullName])];
        if (repo.description) copy.push(el("span", { class: "repo-desc" }, [repo.description]));
        return el("a", { class: "repo", href: repo.url }, [
          el("div", { class: "repo-copy" }, copy),
          el("div", { class: "repo-badges" }, repo.lists.map((item) => el("span", { class: "badge badge-" + item.color }, [item.label]))),
        ]);
      }),
    );
  }

  function setSeg(id, attr, value) {
    for (const button of document.querySelectorAll("#" + id + " button")) {
      button.classList.toggle("is-on", button.getAttribute(attr) === value);
    }
  }

  function chartLayout() {
    const stage = $("chart-stage");
    const width = Math.max(280, stage.clientWidth || $("wrap").clientWidth - 40);
    const narrow = width < 600;
    const padL = 38;
    const padR = 8;
    const padT = 16;
    const plotH = narrow ? 220 : 300;
    const padB = 28;
    const days = visibleDays();
    const n = days.length;
    const step = (width - padL - padR) / Math.max(1, n - 1);
    const xAt = (index) => padL + index * step;
    const yAt = (rank) => padT + ((Math.min(rank, 25) - 1) * plotH) / 24;
    return { width, narrow, padL, padR, padT, plotH, padB, height: padT + plotH + padB, days, n, step, xAt, yAt };
  }

  function drawChart() {
    const layout = chartLayout();
    chart = layout;
    const { width, height, padL, padR, padT, plotH, days, n, xAt, yAt } = layout;
    const stage = $("chart-stage");
    const canvas = svg("svg", { width, height, role: "img", "aria-label": "Daily GitHub Trending rank" });
    const bandH = yAt(10) - padT + 9 + plotH / 48;
    canvas.append(svg("rect", { x: padL, y: padT - 9, width: width - padL - padR, height: bandH, rx: 8, fill: "#EFF6FF" }));

    const ranks = [1, 5, 10, 15, 20, 25];
    const labels = [];
    for (const rank of ranks) {
      const y = yAt(rank);
      canvas.append(svg("line", {
        x1: padL,
        x2: width - padR,
        y1: y,
        y2: y,
        stroke: rank <= 10 ? "#CFDDF3" : "#EAEAEA",
        "stroke-width": 1,
        "stroke-dasharray": "3 4",
      }));
      labels.push(el("span", {
        class: "axis-label",
        style: "left:0;width:" + (padL - 8) + "px;top:" + (y - 7) + "px",
      }, ["#" + rank]));
    }

    let path = "";
    let prev = false;
    const dots = [];
    const golds = [];
    const dotR = n <= 40 ? 3.5 : n <= 120 ? 2.5 : 1.6;
    let onCount = 0;
    days.forEach((day, index) => {
      const point = rankAt(day);
      if (point.kind === "unknown") return;
      if (point.kind === "off") {
        prev = false;
        return;
      }
      onCount += 1;
      const x = +xAt(index).toFixed(1);
      const y = +yAt(point.rank).toFixed(1);
      path += (prev ? "L" : "M") + x + " " + y + " ";
      prev = true;
      if (point.rank === 1) golds.push({ x, y, r: dotR + 1.4, gr: dotR * 2.6 + 2.5 });
      else dots.push({ x, y, r: dotR });
    });
    canvas.append(svg("path", {
      d: path || "M0 0",
      fill: "none",
      stroke: "#2563EB",
      "stroke-width": 1.75,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    }));
    for (const dot of dots) canvas.append(svg("circle", { cx: dot.x, cy: dot.y, r: dot.r, fill: "#2563EB" }));
    for (const dot of golds) {
      canvas.append(svg("circle", { cx: dot.x, cy: dot.y, r: dot.gr, fill: "#D8A40C", opacity: 0.2 }));
      canvas.append(svg("circle", { cx: dot.x, cy: dot.y, r: dot.r, fill: "#D8A40C", stroke: "#fff", "stroke-width": 1 }));
    }

    const guide = svg("line", { class: "guide", y1: padT - 9, y2: padT + plotH });
    guide.hidden = true;
    const hover = svg("circle", { r: 6, fill: "#fff", "stroke-width": 2.5 });
    hover.hidden = true;
    canvas.append(guide, hover);

    const ticks = tickLabels(layout);
    const tickNodes = ticks.map((tick) => el("span", {
      class: "tick-label",
      style: "left:" + (tick.x - 30) + "px;width:60px;top:" + (padT + plotH + 6) + "px",
    }, [tick.label]));

    const tip = el("div", { class: "tip", hidden: "" });
    const empty = emptyState(onCount);
    stage.replaceChildren(canvas, ...labels, ...tickNodes, tip, ...(empty ? [empty] : []));
    canvas.addEventListener("pointermove", onChartMove);
    canvas.addEventListener("pointerleave", () => {
      state.hover = null;
      positionTip();
    });
    chart.canvas = canvas;
    chart.guide = guide;
    chart.hover = hover;
    chart.tip = tip;
    chart.onCount = onCount;
    $("chart-caption").textContent = listLabel() + " developers · on the list " + onCount + " of " + n + " days";
    positionTip();
  }

  function tickLabels(layout) {
    const { days, n, xAt, padL, width, narrow } = layout;
    let candidates = [];
    days.forEach((day, index) => {
      if (day.date.slice(8) !== "01") return;
      const month = +day.date.slice(5, 7);
      if (n > 400 && [1, 4, 7, 10].indexOf(month) < 0) return;
      candidates.push({
        x: xAt(index),
        label: month === 1 ? day.date.slice(0, 4) : fmt(day.date, { month: "short" }),
      });
    });
    if (candidates.length < 3) {
      candidates = [];
      days.forEach((day, index) => {
        if ((n - 1 - index) % 7 === 0) candidates.push({ x: xAt(index), label: fmt(day.date, { month: "short", day: "numeric" }) });
      });
      candidates.reverse();
    }
    const ticks = [];
    let lastX = -1e9;
    for (const tick of candidates) {
      if (tick.x - lastX >= (narrow ? 46 : 54) && tick.x > padL + 12 && tick.x < width - 18) {
        ticks.push(tick);
        lastX = tick.x;
      }
    }
    return ticks;
  }

  function emptyState(onCount) {
    if (onCount !== 0) return null;
    const label = listLabel();
    const phrase = { "30d": "in the last 30 days", "90d": "in the last 90 days", "1y": "in the last year", all: "since " + data.sinceShort }[state.range];
    const title = state.range === "all" ? "No ranking data yet" : "Not on the " + label + " list " + phrase;
    const sub = state.range === "all"
      ? "The tracker checks GitHub Trending every 6 hours. Check back soon."
      : "Days off the list show as gaps. Try a longer range.";
    const card = [el("strong", null, [title]), el("span", null, [sub])];
    if (state.range !== "all") {
      const button = el("button", { type: "button" }, ["Show all time"]);
      button.addEventListener("click", () => {
        state.range = "all";
        state.hover = null;
        setSeg("range-seg", "data-range", "all");
        drawChart();
      });
      card.push(button);
    }
    return el("div", { class: "empty" }, [el("div", { class: "empty-card" }, card)]);
  }

  function onChartMove(event) {
    if (!chart || chart.n === 0) return;
    const rect = chart.canvas.getBoundingClientRect();
    const index = Math.max(0, Math.min(chart.n - 1, Math.round((event.clientX - rect.left - chart.padL) / chart.step)));
    if (index !== state.hover) {
      state.hover = index;
      positionTip();
    }
  }

  function positionTip() {
    if (!chart || !chart.tip) return;
    const index = state.hover;
    const show = index != null && chart.days[index];
    chart.guide.hidden = !show;
    chart.hover.hidden = true;
    chart.tip.hidden = !show;
    if (!show) return;
    const day = chart.days[index];
    const point = rankAt(day);
    const x = chart.xAt(index);
    chart.guide.setAttribute("x1", String(x));
    chart.guide.setAttribute("x2", String(x));
    const ranked = point.kind === "rank";
    if (ranked) {
      const y = chart.yAt(point.rank);
      chart.hover.hidden = false;
      chart.hover.setAttribute("cx", String(x));
      chart.hover.setAttribute("cy", String(y));
      chart.hover.setAttribute("stroke", point.rank === 1 ? "#D8A40C" : "#2563EB");
    }
    const rankText = point.kind === "unknown" ? "Unknown" : point.kind === "off" ? "Off list" : "#" + point.rank;
    const rankColor = point.kind === "rank" && point.rank === 1 ? "#A67C00" : point.kind === "rank" ? "#242424" : "#8E8E8E";
    const repo = point.kind === "unknown"
      ? "Not in the archive"
      : point.kind === "off"
        ? "Not ranked this day"
        : (day[repoKey()] || "Not recorded");
    const list = ranked ? listLabel() + " devs" : listLabel();
    chart.tip.replaceChildren(
      el("span", { class: "tip-date" }, [fmt(day.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })]),
      el("div", { class: "tip-rank-row" }, [
        el("span", { class: "tip-rank", style: "color:" + rankColor }, [rankText]),
        el("span", { class: "tip-list" }, [list]),
      ]),
      el("span", { class: "tip-repo" }, [repo]),
    );
    const tipLeft = Math.min(Math.max(x - 104, 0), chart.width - 208);
    const py = ranked ? chart.yAt(point.rank) : chart.padT + chart.plotH / 2;
    const tipTop = py - 100 > 0 ? py - 100 : py + 18;
    chart.tip.style.left = tipLeft + "px";
    chart.tip.style.top = tipTop + "px";
  }

  function heatColor(day) {
    const point = rankAt(day);
    if (point.kind === "unknown") return "url(#heat-unknown)";
    if (point.kind === "off") return "#F0F0F0";
    const rank = point.rank;
    if (rank === 1) return "#D8A40C";
    if (rank <= 5) return "#2563EB";
    if (rank <= 10) return "#5C89F8";
    if (rank <= 17) return "#C3DEFC";
    return "#D8E9FF";
  }

  function drawHeat() {
    const days = data.days;
    if (!days.length) {
      $("heat-scroll").replaceChildren();
      return;
    }
    const narrow = ($("wrap").clientWidth || 800) < 600;
    const startDow = new Date(days[0].date + "T00:00:00Z").getUTCDay();
    const cols = Math.ceil((startDow + days.length) / 7);
    const labW = 28;
    const topH = 18;
    const chartWidth = Math.max(280, ($("chart-stage").clientWidth || $("wrap").clientWidth) - 0);
    const pitch = narrow ? 12 : Math.max(8, Math.min(16, Math.floor((chartWidth - labW) / cols)));
    const cell = pitch - 2;
    const width = labW + cols * pitch;
    const height = topH + 7 * pitch;
    const canvas = svg("svg", { width, height, role: "img", "aria-label": "Calendar of daily ranks" });
    const pattern = svg("pattern", { id: "heat-unknown", width: 4, height: 4, patternUnits: "userSpaceOnUse" });
    pattern.append(svg("rect", { width: 4, height: 4, fill: "#F7F7F7" }));
    pattern.append(svg("path", { d: "M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2", stroke: "#DDDDDD", "stroke-width": 1 }));
    canvas.append(pattern);

    const cells = days.map((day, index) => {
      const slot = startDow + index;
      return {
        x: labW + Math.floor(slot / 7) * pitch,
        y: topH + (slot % 7) * pitch,
        fill: heatColor(day),
      };
    });
    for (const cellBox of cells) {
      canvas.append(svg("rect", { x: cellBox.x, y: cellBox.y, width: cell, height: cell, rx: 2, fill: cellBox.fill }));
    }
    const ring = svg("rect", { rx: 3, fill: "none", stroke: "#242424", "stroke-width": 1.5 });
    ring.hidden = true;
    canvas.append(ring);

    const layer = el("div", { style: "position:relative;width:" + width + "px;height:" + (height + 2) + "px" });
    const months = [];
    let lastMonth = -1e9;
    days.forEach((day, index) => {
      if (day.date.slice(8) !== "01") return;
      const x = labW + Math.floor((startDow + index) / 7) * pitch;
      if (x - lastMonth < pitch * 3.2) return;
      lastMonth = x;
      const january = day.date.slice(5, 7) === "01";
      months.push(el("span", {
        style: "position:absolute;left:" + x + "px;top:0;font-size:10px;line-height:12px;color:" + (january ? "#242424" : "#8E8E8E") + ";white-space:nowrap;pointer-events:none",
      }, [january ? day.date.slice(0, 4) : fmt(day.date, { month: "short" })]));
    });
    const dow = [["Mon", 1], ["Wed", 3], ["Fri", 5]].map(([label, row]) => el("span", {
      style: "position:absolute;left:0;top:" + (topH + row * pitch + cell / 2 - 6) + "px;font-size:10px;line-height:12px;color:#8E8E8E;pointer-events:none",
    }, [label]));
    layer.append(canvas, ...months, ...dow);
    const scroller = $("heat-scroll");
    const previousScroll = scroller.scrollLeft;
    scroller.replaceChildren(layer);
    $("heat-caption").textContent = "Hover a day";
    canvas.addEventListener("pointermove", (event) => onHeatMove(event, { startDow, pitch, labW, topH, cell }));
    canvas.addEventListener("pointerleave", () => {
      state.heat = null;
      ring.hidden = true;
      $("heat-caption").textContent = "Hover a day";
    });
    heat = { canvas, ring, cells, cell, startDow, pitch, labW, topH, days };
    requestAnimationFrame(() => {
      if (!heatScrolled) {
        scroller.scrollLeft = scroller.scrollWidth;
        heatScrolled = true;
      } else {
        scroller.scrollLeft = previousScroll;
      }
    });
    renderHeatLegend();
    if (state.heat != null) updateHeat();
  }

  function renderHeatLegend() {
    const scale = [
      ["Off list", "#F0F0F0"],
      ["Unknown", "#F7F7F7"],
      ["18–25", "#D8E9FF"],
      ["11–17", "#C3DEFC"],
      ["6–10", "#5C89F8"],
      ["2–5", "#2563EB"],
      ["#1", "#D8A40C"],
    ];
    const hasUnknown = data.days.some((day) => !day[knownKey()]);
    const items = [el("span", null, ["Off list"])];
    for (const [label, color] of scale) {
      if (label === "Off list") continue;
      if (label === "Unknown" && !hasUnknown) continue;
      items.push(el("span", { class: "heat-swatch", title: label, style: "background:" + color + (label === "Unknown" ? ";box-shadow:inset 0 0 0 1px #DDDDDD" : "") }));
    }
    items.push(el("span", null, ["#1"]));
    $("heat-legend").replaceChildren(...items);
  }

  function onHeatMove(event, geom) {
    const rect = event.currentTarget.getBoundingClientRect();
    const col = Math.floor((event.clientX - rect.left - geom.labW) / geom.pitch);
    const row = Math.floor((event.clientY - rect.top - geom.topH) / geom.pitch);
    const index = col * 7 + row - geom.startDow;
    const next = row >= 0 && row < 7 && col >= 0 && index >= 0 && index < data.days.length ? index : null;
    if (next !== state.heat) {
      state.heat = next;
      updateHeat();
    }
  }

  function updateHeat() {
    if (!heat) return;
    const index = state.heat;
    if (index == null || !data.days[index]) {
      heat.ring.hidden = true;
      $("heat-caption").textContent = "Hover a day";
      return;
    }
    const day = data.days[index];
    const point = rankAt(day);
    const cell = heat.cells[index];
    heat.ring.hidden = false;
    heat.ring.setAttribute("x", String(cell.x - 1));
    heat.ring.setAttribute("y", String(cell.y - 1));
    heat.ring.setAttribute("width", String(heat.cell + 2));
    heat.ring.setAttribute("height", String(heat.cell + 2));
    const when = fmt(day.date, { month: "short", day: "numeric", year: "numeric" });
    let detail = "Off list";
    if (point.kind === "unknown") detail = "Unknown";
    else if (point.kind === "rank") detail = "#" + point.rank + (day[repoKey()] ? " · " + day[repoKey()] : "");
    $("heat-caption").textContent = when + " · " + detail;
  }

  function draw() {
    renderCards();
    drawChart();
    drawHeat();
  }

  function bindControls() {
    for (const button of document.querySelectorAll("#list-seg button")) {
      button.addEventListener("click", () => {
        state.list = button.getAttribute("data-list");
        state.hover = null;
        state.heat = null;
        setSeg("list-seg", "data-list", state.list);
        if (data) draw();
      });
    }
    for (const button of document.querySelectorAll("#range-seg button")) {
      button.addEventListener("click", () => {
        state.range = button.getAttribute("data-range");
        state.hover = null;
        setSeg("range-seg", "data-range", state.range);
        if (data) drawChart();
      });
    }
    let lastWidth = 0;
    const observer = new ResizeObserver(() => {
      if (!data) return;
      const width = $("wrap").clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      drawChart();
      drawHeat();
    });
    observer.observe($("wrap"));
  }

  function showError(message) {
    $("hero-body").replaceChildren(el("h1", null, [message]));
    $("chart-caption").textContent = message;
  }

  bindControls();
  fetch("./trending.json")
    .then((response) => {
      if (!response.ok) throw new Error("Could not load trending.json");
      return response.json();
    })
    .then((payload) => {
      data = payload;
      renderIdentity();
      renderHero();
      renderToday();
      renderUpdated();
      renderRepos();
      draw();
    })
    .catch((error) => {
      showError(error instanceof Error ? error.message : "Could not load ranking data.");
    });
})();
