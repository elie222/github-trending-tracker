(function () {
  const state = { list: "typescript", range: "all", mode: "monthly", hover: null, heat: null };
  let data = null;
  let chartWidth = 0;
  let heatReady = false;

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
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

  function listName() {
    return state.list === "typescript" ? "TypeScript" : "All languages";
  }

  function rankKey() {
    return state.list === "typescript" ? "ts" : "all";
  }

  function knownKey() {
    return state.list === "typescript" ? "tsKnown" : "allKnown";
  }

  function repoKey() {
    return state.list === "typescript" ? "tsRepo" : "allRepo";
  }

  function summary() {
    return data.summary[rankKey()];
  }

  function pointAt(day) {
    if (!day[knownKey()]) return { kind: "unknown" };
    const rank = day[rankKey()];
    if (rank == null) return { kind: "off" };
    return { kind: "rank", rank, repo: day[repoKey()] };
  }

  function visibleDays() {
    const n = { "30d": 30, "90d": 90, "1y": 365 }[state.range] || data.days.length;
    return data.days.slice(-n);
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  function syncSegs() {
    for (const seg of document.querySelectorAll(".seg")) {
      const key = seg.dataset.key;
      for (const button of seg.querySelectorAll("button")) {
        button.classList.toggle("is-on", button.dataset.value === state[key]);
      }
    }
  }

  function renderToday() {
    const typescript = data.summary.ts;
    const selected = summary();
    const source = state.list === "typescript" ? typescript : selected;
    $("today-lang").textContent = listName();
    $("today-rank").textContent = source.todayKnown ? (source.today == null ? "Off list" : "#" + source.today) : "Unknown";
    $("live").hidden = false;
    $("live-wait").hidden = true;
  }

  function renderHero() {
    const stats = summary();
    const where = state.list === "typescript" ? " on TypeScript Trending" : " on GitHub Trending";
    let rest = where;
    let rank = "#1";
    if (stats.daysAtOne > 0) rest += " for " + plural(stats.daysAtOne, "day");
    else if (stats.best != null) rank = "#" + stats.best;
    else rank = "—";
    const heading = el("h1", null, [el("span", { class: "hash" }, [rank]), rest === where && stats.daysAtOne === 0 && stats.best == null ? "" : rest]);
    if (stats.daysAtOne === 0 && stats.best == null) heading.textContent = "Not on the list";
    $("hero").replaceChildren(
      heading,
      el("a", { class: "hero-login", href: data.developer.url }, ["@" + data.developer.login]),
    );
  }

  function renderStats() {
    const stats = summary();
    const cards = [
      ["At #1", stats.daysAtOne, "#D8A40C"],
      ["In the top 10", stats.top10, "#2563EB"],
      ["On the list", stats.onList, "#A9CBF7"],
      ["Longest #1 streak", stats.longestOneStreak, null],
      ["Longest on-list streak", stats.longestOnListStreak, null],
      ["Current streak", stats.currentStreak, stats.currentStreak ? "#17A34A" : null],
    ];
    $("stats").replaceChildren(
      ...cards.map(([label, value, dot]) => {
        const name = el("span", { class: "stat-label" }, []);
        if (dot) name.append(el("span", { class: "stat-dot", style: "background:" + dot }));
        name.append(label);
        return el("div", { class: "stat" }, [name, el("span", { class: "stat-value" }, [String(value)])]);
      }),
    );
  }

  function renderUpdated() {
    const node = $("updated");
    node.href = data.repositoryUrl;
    if (!data.updatedAt) {
      node.textContent = "Updated unknown";
      return;
    }
    const then = Date.parse(data.updatedAt);
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
    node.dateTime = data.updatedAt;
    node.title = abs;
    node.textContent = "Updated " + rel;
  }

  function renderRepos() {
    const list = $("repo-list");
    if (!data.repos.length) {
      list.replaceChildren(el("p", { class: "heat-caption" }, ["No tracked repository has trended."]));
      return;
    }
    list.replaceChildren(
      ...data.repos.map((repo) =>
        el("a", { class: "repo", href: repo.url }, [
          el("span", { class: "repo-name" }, [repo.fullName]),
          el(
            "span",
            { class: "repo-badges" },
            repo.lists.map((item) => el("span", { class: "badge badge-" + item.color }, [item.label])),
          ),
        ]),
      ),
    );
  }

  function renderLegend(items) {
    $("legend").replaceChildren(
      ...items.map(([label, color]) =>
        el("span", { class: "legend-item" }, [el("span", { class: "swatch", style: "background:" + color }), label]),
      ),
    );
  }

  function renderChart() {
    const stage = $("chart-stage");
    const width = Math.max(280, stage.clientWidth);
    chartWidth = width;
    const narrow = width < 600;
    const vis = visibleDays();
    const n = vis.length;
    const padL = 34;
    const padT = 22;
    const plotH = narrow ? 200 : 260;
    const padB = 28;
    const CH = padT + plotH + padB;
    const CW = width;
    const titles = { monthly: "Month by month", cumulative: "Days at #1", rank: "Daily rank" };
    $("chart-title").textContent = titles[state.mode];

    if (!n) {
      stage.replaceChildren();
      renderLegend([]);
      return;
    }

    const rankedCount = vis.filter((day) => pointAt(day).kind === "rank").length;
    const base0 = padT + plotH;
    const grid = [];
    const ticks = [];
    const rects = [];
    const ones = [];
    let line = "";
    let area = "";
    let indexAt = () => 0;
    let tipAt = () => null;
    let legend = [];

    const pushTicks = (candidates) => {
      let lastX = -1e9;
      for (const tick of candidates) {
        if (tick.x - lastX >= (narrow ? 44 : 52) && tick.x < CW - 30) {
          ticks.push(tick);
          lastX = tick.x;
        }
      }
    };

    if (state.mode === "monthly") {
      const months = [];
      vis.forEach((day) => {
        const key = day.date.slice(0, 7);
        let month = months[months.length - 1];
        if (!month || month.key !== key) {
          month = { key, one: 0, top: 0, on: 0 };
          months.push(month);
        }
        const point = pointAt(day);
        if (point.kind !== "rank") return;
        if (point.rank === 1) month.one += 1;
        else if (point.rank <= 10) month.top += 1;
        else month.on += 1;
      });
      const count = months.length;
      const slot = (CW - padL) / Math.max(1, count);
      const barW = Math.min(36, slot * 0.62);
      const yAt = (value) => padT + plotH * (1 - value / 31);
      months.forEach((month, index) => {
        const x = padL + index * slot + (slot - barW) / 2;
        let acc = 0;
        for (const [countDays, fill] of [
          [month.one, "#D8A40C"],
          [month.top, "#2563EB"],
          [month.on, "#C3DEFC"],
        ]) {
          if (!countDays) continue;
          const y1 = yAt(acc);
          const y0 = yAt(acc + countDays);
          rects.push({ x, y: y0, w: barW, h: Math.max(1, y1 - y0 - 1.5), fill });
          acc += countDays;
        }
      });
      grid.push(
        { y: yAt(30), label: "30", solid: false },
        { y: yAt(15), label: "15", solid: false },
        { y: base0 + 0.5, label: "0", solid: true },
      );
      const candidates = [];
      months.forEach((month, index) => {
        const mo = Number(month.key.slice(5));
        if (count > 14 && ![1, 4, 7, 10].includes(mo)) return;
        candidates.push({
          x: padL + index * slot + slot / 2 - 12,
          label: mo === 1 ? month.key.slice(0, 4) : fmt(month.key + "-01", { month: "short" }),
          color: mo === 1 ? "#242424" : "#8E8E8E",
        });
      });
      pushTicks(candidates);
      legend = [
        ["#1", "#D8A40C"],
        ["Top 10", "#2563EB"],
        ["On the list", "#C3DEFC"],
      ];
      indexAt = (px) => Math.max(0, Math.min(count - 1, Math.floor((px - padL) / slot)));
      tipAt = (index) => {
        const month = months[index];
        const total = month.one + month.top + month.on;
        return {
          hcol: { x: padL + index * slot, y: padT - 6, w: slot, h: plotH + 6, fill: "#F5F5F5" },
          cx: padL + (index + 0.5) * slot,
          date: fmt(month.key + "-01", { month: "long", year: "numeric" }),
          rank: String(month.one),
          rankColor: month.one ? "#A67C00" : "#242424",
          unit: month.one === 1 ? "day at #1" : "days at #1",
          repo: total ? month.one + month.top + " top 10 · " + total + " on list" : "No days on the list",
        };
      };
    } else {
      const step = (CW - padL - 8) / Math.max(1, n - 1);
      const xAt = (index) => padL + 4 + index * step;
      const dayTicks = () => {
        let candidates = [];
        vis.forEach((day, index) => {
          if (day.date.slice(8) !== "01") return;
          const month = Number(day.date.slice(5, 7));
          if (n > 400 && ![1, 4, 7, 10].includes(month)) return;
          candidates.push({
            x: xAt(index),
            label: month === 1 ? day.date.slice(0, 4) : fmt(day.date, { month: "short" }),
            color: month === 1 ? "#242424" : "#8E8E8E",
          });
        });
        if (candidates.length < 3) {
          candidates = [];
          vis.forEach((day, index) => {
            if ((n - 1 - index) % 7 === 0) {
              candidates.push({
                x: xAt(index),
                label: fmt(day.date, { month: "short", day: "numeric" }),
                color: "#8E8E8E",
              });
            }
          });
        }
        pushTicks(candidates);
      };
      dayTicks();

      if (state.mode === "cumulative") {
        let count = 0;
        const cum = vis.map((day) => {
          const point = pointAt(day);
          if (point.kind === "rank" && point.rank === 1) count += 1;
          return count;
        });
        const top = count <= 10 ? 10 : Math.ceil(count / 20) * 20;
        const yAt = (value) => padT + plotH * (1 - value / top);
        const pts = cum.map((value, index) => [xAt(index), yAt(value)]);
        line = "M" + pts.map((pair) => pair[0].toFixed(1) + " " + pair[1].toFixed(1)).join(" L");
        area = line + " L" + pts[pts.length - 1][0].toFixed(1) + " " + base0 + " L" + pts[0][0].toFixed(1) + " " + base0 + " Z";
        grid.push(
          { y: yAt(top), label: String(top), solid: false },
          { y: yAt(top / 2), label: String(top / 2), solid: false },
          { y: base0 + 0.5, label: "0", solid: true },
        );
        indexAt = (px) => Math.max(0, Math.min(n - 1, Math.round((px - padL - 4) / step)));
        tipAt = (index) => {
          const point = pointAt(vis[index]);
          const detail = point.kind === "unknown" ? "Not in the archive" : point.kind === "off" ? "Off list that day" : "#" + point.rank + " that day";
          return {
            hcol: { x: xAt(index) - 0.5, y: padT - 6, w: 1, h: plotH + 12, fill: "#D0D0D0" },
            cx: xAt(index),
            date: fmt(vis[index].date, { month: "short", day: "numeric", year: "numeric" }),
            rank: String(cum[index]),
            rankColor: "#242424",
            unit: cum[index] === 1 ? "day at #1" : "days at #1",
            repo: detail,
          };
        };
      } else {
        const yAt = (rank) => padT + ((rank - 1) / 25) * plotH;
        const win = n <= 30 ? 1 : n <= 90 ? 3 : 7;
        const half = Math.floor(win / 2);
        const sample = (index) => {
          const point = pointAt(vis[index]);
          if (point.kind === "unknown") return null;
          if (point.kind === "off") return 26;
          return point.rank;
        };
        const smoothed = vis.map((_, index) => {
          let total = 0;
          let count = 0;
          for (let cursor = index - half; cursor <= index + half; cursor += 1) {
            if (cursor < 0 || cursor >= n) continue;
            const value = sample(cursor);
            if (value == null) continue;
            total += value;
            count += 1;
          }
          return count ? total / count : null;
        });
        let drawing = false;
        const parts = [];
        smoothed.forEach((value, index) => {
          if (sample(index) == null) return;
          const command = drawing ? "L" : "M";
          parts.push(command + xAt(index).toFixed(1) + " " + yAt(value).toFixed(1));
          drawing = true;
        });
        line = parts.join(" ");
        if (parts.length) {
          const last = smoothed.findLastIndex((value, index) => sample(index) != null);
          const first = smoothed.findIndex((value, index) => sample(index) != null);
          area = line + " L" + xAt(last).toFixed(1) + " " + base0 + " L" + xAt(first).toFixed(1) + " " + base0 + " Z";
        }
        vis.forEach((day, index) => {
          const point = pointAt(day);
          if (point.kind === "rank" && point.rank === 1) {
            ones.push({ x: xAt(index) - Math.max(1, step * 0.4), w: Math.max(2, step * 0.8) });
          }
        });
        grid.push(
          { y: yAt(1), label: "#1", solid: false },
          { y: yAt(10), label: "#10", solid: false, stroke: "#C3DEFC" },
          { y: yAt(25), label: "", solid: false },
          { y: yAt(26), label: "Off", solid: true },
        );
        legend = [["#1 day", "#D8A40C"]];
        indexAt = (px) => Math.max(0, Math.min(n - 1, Math.round((px - padL - 4) / step)));
        tipAt = (index) => {
          const point = pointAt(vis[index]);
          const ranked = point.kind === "rank";
          return {
            hcol: { x: xAt(index) - 0.5, y: padT - 6, w: 1, h: plotH + 12, fill: "#D0D0D0" },
            cx: xAt(index),
            date: fmt(vis[index].date, { month: "short", day: "numeric", year: "numeric" }),
            rank: point.kind === "unknown" ? "Unknown" : point.kind === "off" ? "Off list" : "#" + point.rank,
            rankColor: ranked && point.rank === 1 ? "#A67C00" : ranked ? "#242424" : "#8E8E8E",
            unit: "",
            repo: point.kind === "unknown" ? "Not in the archive" : point.kind === "off" ? "Not ranked this day" : point.repo || "Not recorded",
          };
        };
      }
    }

    const canvas = svg("svg", { width: CW, height: CH, role: "img", "aria-label": $("chart-title").textContent });
    const tip = state.hover == null ? null : tipAt(state.hover);
    if (tip) {
      canvas.append(svg("rect", {
        x: tip.hcol.x.toFixed(1),
        y: tip.hcol.y.toFixed(1),
        width: Math.max(1, tip.hcol.w).toFixed(1),
        height: tip.hcol.h.toFixed(1),
        fill: tip.hcol.fill,
      }));
    }
    for (const row of grid) {
      canvas.append(svg("line", {
        x1: padL,
        x2: CW,
        y1: row.y.toFixed(1),
        y2: row.y.toFixed(1),
        stroke: row.stroke || (row.solid ? "#E3E3E3" : "#EFEFEF"),
        "stroke-width": 1,
        "stroke-dasharray": row.solid ? "none" : "3 4",
      }));
    }
    if (area) canvas.append(svg("path", { d: area, fill: "#EFF6FF" }));
    if (line && state.mode !== "monthly") {
      canvas.append(svg("path", { d: line, fill: "none", stroke: "#2563EB", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    }
    for (const mark of ones) {
      canvas.append(svg("rect", { x: mark.x.toFixed(1), y: padT - 12, width: mark.w.toFixed(1), height: 4, rx: 1, fill: "#D8A40C" }));
    }
    for (const bar of rects) {
      canvas.append(svg("rect", { x: bar.x.toFixed(1), y: bar.y.toFixed(1), width: bar.w.toFixed(1), height: bar.h.toFixed(1), rx: 2, fill: bar.fill }));
    }

    canvas.addEventListener("pointermove", (event) => {
      const bounds = canvas.getBoundingClientRect();
      const next = indexAt(event.clientX - bounds.left);
      if (next === state.hover) return;
      state.hover = next;
      renderChart();
    });
    canvas.addEventListener("pointerleave", () => {
      if (state.hover == null) return;
      state.hover = null;
      renderChart();
    });

    const labels = grid.map((row) =>
      el("span", {
        class: "axis-label",
        style: "left:0;width:" + (padL - 8) + "px;top:" + (row.y - 7) + "px",
      }, [row.label]),
    );
    const tickNodes = ticks.map((tick) =>
      el("span", {
        class: "tick-label",
        style: "left:" + tick.x + "px;top:" + (padT + plotH + 10) + "px;color:" + tick.color,
      }, [tick.label]),
    );
    const nodes = [canvas, ...labels, ...tickNodes];
    if (tip) {
      const left = tip.cx + 212 < CW ? tip.cx + 12 : Math.max(0, tip.cx - 212);
      const rank = el("span", { class: "tip-rank", style: "color:" + tip.rankColor }, [tip.rank]);
      const row = el("div", { class: "tip-row" }, [rank]);
      if (tip.unit) row.append(el("span", { class: "tip-unit" }, [tip.unit]));
      const tipNode = el("div", { class: "tip", style: "left:" + left + "px" }, [el("span", { class: "tip-date" }, [tip.date]), row]);
      if (tip.repo) tipNode.append(el("span", { class: "tip-repo" }, [tip.repo]));
      nodes.push(tipNode);
    }
    if (rankedCount === 0) {
      const phrase = { "30d": "in the last 30 days", "90d": "in the last 90 days", "1y": "in the last year", all: "since Nov 2024" }[state.range];
      const card = el("div", { class: "empty-card" }, [
        el("strong", null, [state.range === "all" ? "No ranking data yet" : "Not on the " + listName() + " list " + phrase]),
        el("span", null, [state.range === "all" ? "The tracker checks GitHub Trending every 6 hours. Check back soon." : "Try a longer range."]),
      ]);
      if (state.range !== "all") {
        const button = el("button", { type: "button" }, ["Show all time"]);
        button.addEventListener("click", () => {
          state.range = "all";
          state.hover = null;
          syncSegs();
          renderChart();
        });
        card.append(button);
      }
      nodes.push(el("div", { class: "empty" }, [card]));
    }
    stage.replaceChildren(...nodes);
    renderLegend(legend);
  }

  function heatColor(point) {
    if (point.kind === "unknown") return "url(#heat-unknown)";
    if (point.kind === "off") return "#F2F2F2";
    if (point.rank === 1) return "#D8A40C";
    if (point.rank <= 5) return "#2563EB";
    if (point.rank <= 10) return "#5C89F8";
    if (point.rank <= 17) return "#A9CBF7";
    return "#D8E9FF";
  }

  function renderHeat() {
    const scroller = $("heat-scroll");
    const previous = scroller.scrollLeft;
    const first = !heatReady;
    const days = data.days;
    const narrow = (chartWidth || scroller.clientWidth || 320) < 600;
    const startDow = new Date(days[0].date + "T00:00:00Z").getUTCDay();
    const cols = Math.ceil((startDow + days.length) / 7);
    const labW = 28;
    const topH = 18;
    const plotW = Math.max(280, $("wrap").clientWidth) - labW;
    const pitch = narrow ? 12 : Math.max(8, Math.min(16, Math.floor(plotW / cols)));
    const cell = pitch - 2;
    const width = labW + cols * pitch;
    const height = topH + 7 * pitch;
    const cells = days.map((day, index) => {
      const slot = startDow + index;
      return {
        x: labW + Math.floor(slot / 7) * pitch,
        y: topH + (slot % 7) * pitch,
        fill: heatColor(pointAt(day)),
      };
    });
    const canvas = svg("svg", { width, height, role: "img", "aria-label": "Every day" });
    const pattern = svg("pattern", { id: "heat-unknown", width: 4, height: 4, patternUnits: "userSpaceOnUse" });
    pattern.append(svg("rect", { width: 4, height: 4, fill: "#F7F7F7" }));
    pattern.append(svg("path", { d: "M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2", stroke: "#DDDDDD", "stroke-width": 1 }));
    canvas.append(pattern);
    cells.forEach((cellBox) => {
      canvas.append(svg("rect", { x: cellBox.x, y: cellBox.y, width: cell, height: cell, rx: 2, fill: cellBox.fill }));
    });
    const ring = svg("rect", { rx: 3, fill: "none", stroke: "#242424", "stroke-width": 1.5, visibility: "hidden" });
    canvas.append(ring);

    const months = [];
    let lastX = -1e9;
    days.forEach((day, index) => {
      if (day.date.slice(8) !== "01") return;
      const x = labW + Math.floor((startDow + index) / 7) * pitch;
      if (x - lastX < pitch * 3.2) return;
      lastX = x;
      const january = day.date.slice(5, 7) === "01";
      months.push(el("span", {
        class: "heat-month",
        style: "left:" + x + "px;top:0;color:" + (january ? "#242424" : "#8E8E8E"),
      }, [january ? day.date.slice(0, 4) : fmt(day.date, { month: "short" })]));
    });
    const dow = [
      [1, "Mon"],
      [3, "Wed"],
      [5, "Fri"],
    ].map(([row, label]) =>
      el("span", { class: "heat-dow", style: "left:0;top:" + (topH + row * pitch + cell / 2 - 6) + "px" }, [label]),
    );

    const paint = (index) => {
      const caption = $("heat-caption");
      if (index == null) {
        ring.setAttribute("visibility", "hidden");
        caption.textContent = "";
        return;
      }
      const box = cells[index];
      ring.setAttribute("visibility", "visible");
      ring.setAttribute("x", box.x - 1);
      ring.setAttribute("y", box.y - 1);
      ring.setAttribute("width", cell + 2);
      ring.setAttribute("height", cell + 2);
      const point = pointAt(days[index]);
      const when = fmt(days[index].date, { month: "short", day: "numeric", year: "numeric" });
      const detail = point.kind === "unknown" ? "Unknown" : point.kind === "off" ? "Off list" : "#" + point.rank + (point.repo ? " · " + point.repo : " · Not recorded");
      caption.textContent = when + " · " + detail;
    };
    canvas.addEventListener("pointermove", (event) => {
      const bounds = canvas.getBoundingClientRect();
      const col = Math.floor((event.clientX - bounds.left - labW) / pitch);
      const row = Math.floor((event.clientY - bounds.top - topH) / pitch);
      const index = col * 7 + row - startDow;
      const next = row >= 0 && row < 7 && col >= 0 && index >= 0 && index < days.length ? index : null;
      if (next === state.heat) return;
      state.heat = next;
      paint(next);
    });
    canvas.addEventListener("pointerleave", () => {
      state.heat = null;
      paint(null);
    });

    const board = el("div", { class: "heat-board", style: "width:" + width + "px;height:" + height + "px" }, [...months, ...dow, canvas]);
    scroller.replaceChildren(board);
    const snap = first ? scroller.scrollWidth : previous;
    scroller.scrollLeft = snap;
    heatReady = true;
    requestAnimationFrame(() => {
      scroller.scrollLeft = first ? scroller.scrollWidth : snap;
    });
    if (state.heat != null) paint(state.heat);
  }

  function render() {
    renderToday();
    renderHero();
    renderStats();
    renderUpdated();
    renderRepos();
    renderChart();
    renderHeat();
  }

  document.querySelector(".chart-controls").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !data) return;
    const seg = button.closest(".seg");
    state[seg.dataset.key] = button.dataset.value;
    state.hover = null;
    if (seg.dataset.key === "list") state.heat = null;
    syncSegs();
    render();
  });

  const stage = $("chart-stage");
  if (window.ResizeObserver) {
    let width = 0;
    const observer = new ResizeObserver(() => {
      const next = stage.clientWidth;
      if (!data || !next || next === width) return;
      width = next;
      renderChart();
      renderHeat();
    });
    observer.observe(stage);
  }

  const bars = $("chart-skel");
  const count = window.innerWidth < 600 ? 24 : 48;
  for (let index = 0; index < count; index += 1) {
    const height = 30 + Math.round(50 * Math.abs(Math.sin(index * 0.7) * Math.cos(index * 0.23)));
    bars.append(el("div", { class: "skel-bar", style: "height:" + height + "%" }));
  }

  fetch("./trending.json")
    .then((response) => {
      if (!response.ok) throw new Error("trending.json " + response.status);
      return response.json();
    })
    .then((payload) => {
      data = payload;
      render();
    })
    .catch(() => {
      $("hero").replaceChildren(el("h1", null, ["The rank history could not be loaded."]));
      $("chart-stage").replaceChildren();
    });
})();
