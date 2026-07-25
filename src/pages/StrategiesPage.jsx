import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  STRATEGY_METRICS,
  STRATEGY_PRESETS,
  buildHistoricalSimulation,
  createBlankStrategy,
  explainRule,
  makeActivity,
  nextRunDate,
  normalizeStrategy,
  paperAccountValue,
  strategyFromOriDraft,
  strategyFromPreset,
} from "../lib/strategies.js";
import { strategyToYaml, validateStrategyYaml } from "../lib/strategyYaml.js";
import OriEmblem from "../components/OriEmblem.jsx";

const BRAND_FONT = { fontFamily: '"Space Grotesk", system-ui, sans-serif' };

function Icon({ name, className = "w-5 h-5" }) {
  const paths = {
    strategy: <><path d="M4 19V9m8 10V5m8 14v-7" /><path d="m2.5 9 3-3 3 3m0-4 3-3 3 3m0 7 3-3 3 3" /></>,
    spark: <><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8m7.8 7.8 2.8 2.8m0-13.4-2.8 2.8m-7.8 7.8-2.8 2.8" /><circle cx="12" cy="12" r="3.2" /></>,
    play: <path d="m8 5 11 7-11 7z" />,
    pause: <><path d="M9 5v14M15 5v14" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7M10 11v6m4-6v6" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
    back: <path d="m15 18-6-6 6-6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    cash: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M7 9H5v2m12 4h2v-2" /></>,
    chart: <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></>,
    alert: <><path d="M12 3 2.5 20h19z" /><path d="M12 9v4m0 3h.01" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.strategy}
    </svg>
  );
}

const money = (value, digits = 0) => Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
const percent = (value, digits = 1) => `${Number(value || 0) >= 0 ? "+" : ""}${(Number(value || 0) * 100).toFixed(digits)}%`;
const shortDate = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(value).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) : "Not run yet";
const dateTime = (value) => value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "-";

function SourceBadge({ source, compact = false }) {
  const config = source === "ori"
    ? { label: "Ori decision", classes: "border-cyan-700/50 bg-cyan-950/40 text-cyan-300" }
    : source === "rule"
      ? { label: "Fixed rule", classes: "border-amber-700/50 bg-amber-950/30 text-amber-300" }
      : { label: "System", classes: "border-gray-700 bg-gray-800/70 text-gray-400" };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold uppercase tracking-[0.12em] ${compact ? "text-[8px]" : "text-[9px]"} ${config.classes}`}>{config.label}</span>;
}

function SimulatedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-700/50 bg-blue-950/30 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-blue-300">
      <span className="h-1.5 w-1.5 rounded-full bg-blue-400" /> Simulated money
    </span>
  );
}

function EmptyWorkspace({ canUseOri, onUpgrade, onAddPreset, onOpenManual, onOpenOri, strategyCount }) {
  const [idea, setIdea] = useState("");
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const ideaStarters = [
    "Follow strong sectors, but avoid overheated ones",
    "Own durable companies and protect against big drawdowns",
    "Stay in broad ETFs when trends are healthy, otherwise hold cash",
  ];
  const atLimit = strategyCount >= 20;

  async function buildWithOri() {
    if (atLimit) { setError("You can keep up to 20 strategies. Delete one before creating another."); return; }
    if (!canUseOri) { onUpgrade?.(); return; }
    if (idea.trim().length < 12) { setError("Tell Ori a little more about the idea and the risk you want."); return; }
    setBuilding(true);
    setError("");
    try {
      const response = await fetch("/api/strategies/ori/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Ori could not build the draft.");
      onOpenOri(strategyFromOriDraft(data.draft, idea));
    } catch (err) {
      setError(err.message);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain">
      <section className="relative overflow-hidden border-b border-gray-800 px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
        <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-32 w-96 bg-gradient-to-r from-transparent via-blue-500/5 to-transparent blur-2xl" />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-400">Strategies</span>
            <SimulatedBadge />
          </div>
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.03em] text-gray-50 sm:text-4xl" style={BRAND_FONT}>
            Describe the behavior. Ori builds the machinery.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-400">
            Create an automated paper portfolio in everyday language. You review a simple plan, set the safety limits, and see why every simulated trade happened.
          </p>

          <div className="mt-6 flex max-w-3xl flex-wrap items-center gap-2 text-[10px] text-gray-500">
            {['Describe an idea', 'Review the plan', 'Simulate it'].map((label, index) => <div key={label} className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-700 bg-gray-900 font-bold text-gray-300">{index + 1}</span><span>{label}</span>{index < 2 && <Icon name="chevron" className="h-3 w-3 text-gray-700" />}</div>)}
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_230px] lg:items-stretch">
            <div className="relative overflow-hidden rounded-2xl border border-cyan-800/50 bg-gray-900/80 p-5 shadow-xl shadow-black/10">
              <div className="absolute right-4 top-4 opacity-70"><OriEmblem className="h-9 w-9" /></div>
              <div className="pr-12">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-100"><Icon name="spark" className="h-4 w-4 text-cyan-400" /> What should your strategy do?</div>
                <p className="mt-1 text-xs text-gray-500">Include what to invest in, what a good opportunity looks like, and what should make it cautious.</p>
              </div>
              <textarea
                value={idea}
                onChange={(event) => setIdea(event.target.value)}
                rows={3}
                placeholder="Example: Rotate among US sectors monthly. Buy only positive momentum with a healthy RSI, keep 15% cash, and let Ori break close ties."
                className="mt-4 w-full resize-none rounded-xl border border-gray-700 bg-gray-950/80 px-4 py-3 text-sm leading-5 text-gray-100 outline-none transition focus:border-cyan-600 placeholder:text-gray-600"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ideaStarters.map((starter) => <button key={starter} type="button" onClick={() => { setIdea(starter); setError(""); }} className="rounded-full border border-gray-800 bg-gray-950/60 px-2.5 py-1 text-[9px] text-gray-500 transition hover:border-gray-700 hover:text-gray-300">{starter}</button>)}
              </div>
              {(error || atLimit) && <p className="mt-2 text-xs text-red-400">{error || "You can keep up to 20 strategies. Delete one before creating another."}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[10px] text-gray-500">You will review the plan before it can run.</span>
                <button onClick={buildWithOri} disabled={building || atLimit} className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50">
                  {building ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Icon name="spark" className="h-3.5 w-3.5" />}
                  {building ? "Building your plan..." : canUseOri ? "Build my strategy" : "Unlock Ori builder"}
                </button>
              </div>
            </div>
            <button onClick={onOpenManual} disabled={atLimit} className="group flex min-h-40 w-full flex-col justify-between rounded-2xl border border-gray-800 bg-gray-900/40 p-5 text-left transition hover:border-gray-700 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-45">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-700 bg-gray-950 text-gray-300"><Icon name="plus" className="h-4 w-4" /></span>
              <span><span className="block text-sm font-semibold text-gray-200">Start with a simple plan</span><span className="mt-1 block text-xs leading-5 text-gray-500">Choose the investments, schedule, and safety limits yourself. Add sophistication later.</span></span>
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-gray-100" style={BRAND_FONT}>Or start with a ready-made approach</h2>
            <p className="mt-1 text-xs text-gray-500">Pick the behavior that sounds right. You can change every safety limit later.</p>
          </div>
          {strategyCount > 0 && <span className="text-xs text-gray-500">{strategyCount} saved{atLimit ? " | Limit reached" : ""}</span>}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {STRATEGY_PRESETS.map((preset, index) => {
            const tones = ["text-cyan-300 border-cyan-900/60", "text-emerald-300 border-emerald-900/60", "text-amber-300 border-amber-900/60"];
            return (
              <button key={preset.presetId} onClick={() => onAddPreset(preset.presetId)} disabled={atLimit} className={`group relative overflow-hidden rounded-2xl border bg-gray-900/55 p-5 text-left transition hover:-translate-y-0.5 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-45 ${tones[index]}`}>
                <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-current opacity-[0.035] transition group-hover:scale-125" />
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-current/30 bg-gray-950/70"><Icon name={index === 2 ? "shield" : index === 1 ? "chart" : "strategy"} className="h-4 w-4" /></span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-gray-500">{preset.limits.allowOri ? "Rules + Ori" : "Rules only"}</span>
                </div>
                <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-current">{preset.eyebrow}</p>
                <h3 className="mt-1 text-base font-semibold text-gray-100">{preset.name}</h3>
                <p className="mt-2 min-h-14 text-xs leading-5 text-gray-500">{preset.description}</p>
                <div className="mt-5 flex items-center justify-between border-t border-gray-800 pt-4">
                  <span className="text-[10px] text-gray-500">Checks {preset.limits.rebalance.toLowerCase()} | Keeps {preset.limits.cashReservePct}% cash</span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-gray-300 group-hover:text-gray-100">Choose <Icon name="chevron" className="h-3 w-3" /></span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function StrategyYamlPreview({ validation }) {
  const strategy = validation.strategy;
  if (!strategy) return <div className="space-y-2 p-4">{validation.errors.slice(0, 8).map((error, index) => <div key={`${error}:${index}`} className="flex gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[10px] leading-4 text-red-300"><span className="font-mono text-red-500">{index + 1}</span><span>{error}</span></div>)}</div>;
  return <div className="space-y-4 p-4"><div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-400">Compiles successfully</p><h3 className="mt-1 text-base font-semibold text-gray-100">{strategy.name}</h3><p className="mt-1 text-[10px] leading-4 text-gray-500">{strategy.description}</p></div><div className="grid grid-cols-2 gap-2">{[{ label: "Universe", value: strategy.universe.type === "symbols" ? `${strategy.universe.symbols.length} symbols` : "Tracked stocks" }, { label: "Filters", value: `${strategy.rules.length} fixed` }, { label: "Branches", value: `${strategy.branches.length} + else` }, { label: "Paper cash", value: money(strategy.paper.startingCash) }].map((item) => <div key={item.label} className="rounded-lg border border-gray-800 bg-gray-950/60 p-2.5"><p className="text-[8px] font-bold uppercase tracking-wider text-gray-600">{item.label}</p><p className="mt-1 text-[11px] font-semibold text-gray-300">{item.value}</p></div>)}</div><div><p className="mb-2 text-[9px] font-bold uppercase tracking-wider text-gray-600">Execution order</p><div className="space-y-2"><div className="rounded-lg border border-amber-900/35 bg-amber-950/10 p-2.5"><p className="text-[9px] font-bold text-amber-300">IF eligibility matches ALL</p><p className="mt-1 text-[10px] leading-4 text-gray-500">{strategy.rules.map((rule) => rule.label || explainRule(rule)).join("; ")}</p></div>{strategy.branches.map((branch, index) => <div key={branch.id} className="rounded-lg border border-cyan-900/35 bg-cyan-950/10 p-2.5"><p className="text-[9px] font-bold text-cyan-300">WHEN {index + 1}: {branch.name}</p><p className="mt-1 text-[10px] leading-4 text-gray-500">Match {branch.match.toUpperCase()}, THEN {branch.action}{branch.action === "exclude" ? "" : ` at ${Number(branch.multiplier).toFixed(2)}x`}.</p></div>)}<div className="rounded-lg border border-gray-800 bg-gray-950/60 p-2.5"><p className="text-[9px] font-bold text-gray-400">ELSE</p><p className="mt-1 text-[10px] text-gray-500">Use normal 1.00x weight.</p></div></div></div><div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-[10px] leading-4 text-gray-500"><span className="font-semibold text-gray-300">Hard limits:</span> {strategy.limits.maxPositions} positions, {strategy.limits.maxPositionPct}% max each, {strategy.limits.cashReservePct}% minimum cash. {strategy.limits.allowOri ? `Ori may rank survivors above ${strategy.limits.minOriConfidence}% confidence.` : "Ori decisions are off."}</div></div>;
}

function StrategyYamlEditor({ initial, canUseOri, onUpgrade, onCancel, onSave, isNew = false }) {
  const [source, setSource] = useState(() => strategyToYaml(initial));
  const [instruction, setInstruction] = useState("");
  const [building, setBuilding] = useState(false);
  const [actionError, setActionError] = useState("");
  const deferredSource = useDeferredValue(source);
  const validation = useMemo(() => validateStrategyYaml(deferredSource, initial), [deferredSource, initial]);
  const metricsByGroup = useMemo(() => Object.entries(STRATEGY_METRICS).filter(([, metric]) => !metric.legacy).reduce((groups, [key, metric]) => ({ ...groups, [metric.group]: [...(groups[metric.group] || []), key] }), {}), []);

  function insertIndent(event) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const target = event.currentTarget;
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    setSource((current) => `${current.slice(0, start)}  ${current.slice(end)}`);
    requestAnimationFrame(() => {
      target.selectionStart = start + 2;
      target.selectionEnd = start + 2;
    });
  }

  async function rewriteWithOri() {
    if (!canUseOri) { onUpgrade?.(); return; }
    if (instruction.trim().length < 12) { setActionError("Describe what Ori should add or change in a little more detail."); return; }
    setBuilding(true);
    setActionError("");
    try {
      const response = await fetch("/api/strategies/ori/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: instruction, currentYaml: source }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Ori could not rewrite the strategy.");
      const generated = strategyFromOriDraft(data.draft, instruction, initial.paper.startingCash);
      const merged = normalizeStrategy({
        ...generated,
        id: initial.id,
        status: initial.status,
        createdAt: initial.createdAt,
        lastRunAt: initial.lastRunAt,
        nextRunAt: initial.nextRunAt,
        paper: initial.paper,
        backtest: initial.backtest,
        lastDecision: initial.lastDecision,
        activity: [makeActivity("ori", "Ori rewrote the strategy YAML", `Ori applied this instruction: ${instruction.slice(0, 180)}. The YAML still required review and validation before saving.`), ...(initial.activity || [])],
      });
      setSource(strategyToYaml(merged));
      setInstruction("");
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBuilding(false);
    }
  }

  function save() {
    const current = validateStrategyYaml(source, initial);
    if (!current.strategy) { setActionError(current.errors[0]); return; }
    onSave(current.strategy);
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}><div className="flex max-h-[97dvh] w-full max-w-7xl flex-col overflow-hidden rounded-t-2xl border border-gray-700 bg-gray-900 shadow-2xl sm:max-h-[94dvh] sm:rounded-2xl"><div className="flex items-start justify-between gap-4 border-b border-gray-800 px-5 py-4 sm:px-6"><div><p className="text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-400">{isNew ? "Review generated logic" : "Edit strategy logic"}</p><h2 className="mt-1 text-lg font-semibold text-gray-100" style={BRAND_FONT}>Strategy as YAML</h2><p className="mt-1 text-[10px] text-gray-500">Ori can write it. The compiler, fixed limits, and your review decide whether it can run.</p></div><button onClick={onCancel} className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-gray-200" aria-label="Close">x</button></div><div className="border-b border-gray-800 bg-gradient-to-r from-cyan-950/25 via-gray-900 to-gray-900 px-5 py-4 sm:px-6"><div className="flex flex-col gap-2 lg:flex-row"><div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-cyan-900/50 bg-gray-950/70 px-3"><OriEmblem className="h-5 w-5 shrink-0" /><input value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !building && rewriteWithOri()} placeholder="Tell Ori what to change, e.g. add a volatility escape branch and keep 20% cash" className="min-w-0 flex-1 bg-transparent py-3 text-xs text-gray-200 outline-none placeholder:text-gray-600" /></div><button onClick={rewriteWithOri} disabled={building} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">{building ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Icon name="spark" className="h-3.5 w-3.5" />}{building ? "Rewriting YAML..." : canUseOri ? "Autofill with Ori" : "Unlock Ori autofill"}</button></div>{actionError && <p className="mt-2 text-[10px] text-red-400">{actionError}</p>}</div><div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(310px,0.75fr)]"><section className="flex min-h-[56vh] min-w-0 flex-col border-b border-gray-800 lg:border-b-0 lg:border-r"><div className="flex items-center justify-between border-b border-gray-800 bg-gray-950/70 px-4 py-2"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-cyan-400" /><span className="font-mono text-[10px] text-gray-400">strategy.yaml</span></div><div className="flex items-center gap-3"><span className={`text-[9px] font-bold uppercase tracking-wider ${validation.strategy ? "text-emerald-400" : "text-red-400"}`}>{validation.strategy ? "Valid" : `${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}`}</span><button onClick={() => { setSource(strategyToYaml(initial)); setActionError(""); }} className="text-[9px] text-gray-600 hover:text-gray-300">Reset</button></div></div><textarea value={source} onChange={(event) => setSource(event.target.value)} onKeyDown={insertIndent} spellCheck={false} aria-label="Strategy YAML" className="min-h-[56vh] flex-1 resize-none bg-[#080d14] px-5 py-4 font-mono text-[12px] leading-5 text-slate-300 outline-none selection:bg-cyan-900/60 lg:min-h-0" style={{ tabSize: 2 }} /><div className="flex items-center justify-between border-t border-gray-800 bg-gray-950/70 px-4 py-2 text-[9px] text-gray-600"><span>YAML v1 | {source.split("\n").length} lines</span><span>Percentages: 15% | Lookbacks: trading days</span></div></section><aside className="min-h-0 overflow-y-auto bg-gray-900/70"><div className="border-b border-gray-800 px-4 py-3"><p className="text-[9px] font-bold uppercase tracking-[0.15em] text-gray-500">Compiled preview</p><p className="mt-1 text-[10px] text-gray-600">This is what the engine will execute.</p></div><StrategyYamlPreview validation={validation} /><details className="border-t border-gray-800 px-4 py-3"><summary className="cursor-pointer text-[10px] font-semibold text-gray-400">Metric reference</summary><div className="mt-3 space-y-3">{Object.entries(metricsByGroup).map(([group, metrics]) => <div key={group}><p className="text-[8px] font-bold uppercase tracking-wider text-gray-600">{group}</p><p className="mt-1 font-mono text-[9px] leading-4 text-gray-500">{metrics.join("  ")}</p></div>)}</div></details><div className="m-4 flex gap-2 rounded-lg border border-amber-900/35 bg-amber-950/10 p-3"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" /><p className="text-[9px] leading-4 text-gray-500">Stale or missing market context cannot pass a condition. Ori cannot override eligibility, branch exclusions, or portfolio limits.</p></div></aside></div><div className="flex items-center justify-between gap-3 border-t border-gray-800 bg-gray-950/80 px-5 py-4 sm:px-6"><p className="hidden text-[10px] text-gray-500 sm:block">Paper trading only. Saving compiles YAML into safe strategy logic.</p><div className="ml-auto flex gap-2"><button onClick={onCancel} className="rounded-lg border border-gray-700 px-4 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">Cancel</button><button onClick={save} disabled={!validation.strategy} className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">{isNew ? "Save paper strategy" : "Compile and save"}</button></div></div></div></div>;
}

function PlanStep({ number, title, badge = "rule", children, tone = "gray" }) {
  const tones = {
    gray: "border-gray-800 bg-gray-950/45",
    cyan: "border-cyan-900/45 bg-cyan-950/10",
    amber: "border-amber-900/40 bg-amber-950/10",
  };
  return <section className={`rounded-2xl border p-4 sm:p-5 ${tones[tone]}`}><div className="flex items-center gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-700 bg-gray-900 text-[10px] font-bold text-gray-300">{number}</span><div><SourceBadge source={badge} compact /><h3 className="mt-1 text-sm font-semibold text-gray-100">{title}</h3></div></div><div className="mt-4">{children}</div></section>;
}

function StrategyEditor({ initial, canUseOri, onUpgrade, onCancel, onSave, isNew = false }) {
  const [draft, setDraft] = useState(() => normalizeStrategy(initial));
  const [instruction, setInstruction] = useState("");
  const [building, setBuilding] = useState(false);
  const [actionError, setActionError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  function updateDraft(change) {
    setDraft((current) => normalizeStrategy(typeof change === "function" ? change(current) : { ...current, ...change }));
    setActionError("");
  }

  async function rewriteWithOri() {
    if (!canUseOri) { onUpgrade?.(); return; }
    if (instruction.trim().length < 8) { setActionError("Tell Ori what you want to change in a little more detail."); return; }
    setBuilding(true);
    setActionError("");
    try {
      const response = await fetch("/api/strategies/ori/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: instruction, currentYaml: strategyToYaml(draft) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Ori could not update the plan.");
      const generated = strategyFromOriDraft(data.draft, instruction, draft.paper.startingCash);
      setDraft(normalizeStrategy({
        ...generated,
        id: draft.id,
        status: draft.status,
        createdAt: draft.createdAt,
        lastRunAt: draft.lastRunAt,
        nextRunAt: draft.nextRunAt,
        paper: draft.paper,
        backtest: draft.backtest,
        lastDecision: draft.lastDecision,
        activity: [makeActivity("ori", "Ori updated the strategy plan", `Ori applied this request: ${instruction.slice(0, 180)}. You reviewed the plain-English plan before saving.`), ...(draft.activity || [])],
      }));
      setInstruction("");
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBuilding(false);
    }
  }

  if (showAdvanced) {
    return <StrategyYamlEditor initial={draft} isNew={isNew} canUseOri={canUseOri} onUpgrade={onUpgrade} onCancel={() => setShowAdvanced(false)} onSave={onSave} />;
  }

  const universeText = draft.universe.type === "symbols"
    ? `${draft.universe.symbols.length} chosen ticker${draft.universe.symbols.length === 1 ? "" : "s"}`
    : `All tracked stocks${draft.universe.includeEtfs ? " and ETFs" : ""}`;
  const rankingLabel = STRATEGY_METRICS[draft.ranking.primary]?.label || draft.ranking.primary;

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
    <div className="flex max-h-[97dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-gray-700 bg-gray-900 shadow-2xl sm:max-h-[94dvh] sm:rounded-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-gray-800 px-5 py-4 sm:px-6">
        <div><p className="text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-400">{isNew ? "Review before saving" : "Edit strategy"}</p><h2 className="mt-1 text-lg font-semibold text-gray-100" style={BRAND_FONT}>{isNew ? "Here is the plan" : `Adjust ${draft.name}`}</h2><p className="mt-1 text-[10px] text-gray-500">Read it top to bottom. The system repeats these steps whenever it checks the market.</p></div>
        <button onClick={onCancel} className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-gray-200" aria-label="Close">x</button>
      </header>

      <div className="border-b border-gray-800 bg-gradient-to-r from-cyan-950/25 via-gray-900 to-gray-900 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-2 lg:flex-row"><div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-cyan-900/50 bg-gray-950/70 px-3"><OriEmblem className="h-5 w-5 shrink-0" /><input value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !building && rewriteWithOri()} placeholder="Ask Ori to change anything, e.g. be more cautious when volatility rises" className="min-w-0 flex-1 bg-transparent py-3 text-xs text-gray-200 outline-none placeholder:text-gray-600" /></div><button onClick={rewriteWithOri} disabled={building} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">{building ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Icon name="spark" className="h-3.5 w-3.5" />}{building ? "Updating plan..." : canUseOri ? "Update my plan" : "Unlock Ori"}</button></div>
        {actionError && <p className="mt-2 text-[10px] text-red-400">{actionError}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-gray-900/70 px-5 py-5 sm:px-6">
        <div className="mx-auto grid max-w-5xl gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.7fr)]">
          <main className="min-w-0 space-y-4">
            <div className="rounded-2xl border border-gray-800 bg-gray-950/45 p-4 sm:p-5"><label htmlFor="strategy-name" className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-600">Strategy name</label><input id="strategy-name" value={draft.name} maxLength={60} onChange={(event) => updateDraft({ ...draft, name: event.target.value })} className="mt-2 w-full border-0 bg-transparent p-0 text-xl font-semibold text-gray-100 outline-none placeholder:text-gray-700" placeholder="Name this strategy" /><textarea value={draft.description} maxLength={500} rows={2} onChange={(event) => updateDraft({ ...draft, description: event.target.value })} className="mt-2 w-full resize-none border-0 bg-transparent p-0 text-xs leading-5 text-gray-500 outline-none placeholder:text-gray-700" placeholder="What is this strategy trying to accomplish?" /></div>

            <PlanStep number="1" title="Choose what it can buy">
              <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => updateDraft((current) => ({ ...current, universe: { ...current.universe, type: "stocks" } }))} className={`rounded-xl border px-3 py-3 text-left transition ${draft.universe.type === "stocks" ? "border-cyan-700/60 bg-cyan-950/25" : "border-gray-800 bg-gray-900/50 hover:border-gray-700"}`}><span className="block text-xs font-semibold text-gray-200">Tracked stocks</span><span className="mt-1 block text-[9px] leading-4 text-gray-500">Use your research universe</span></button><button type="button" onClick={() => updateDraft((current) => ({ ...current, universe: { ...current.universe, type: "symbols", symbols: current.universe.symbols.length ? current.universe.symbols : ["SPY", "QQQ", "IWM", "GLD", "TLT"], includeEtfs: true } }))} className={`rounded-xl border px-3 py-3 text-left transition ${draft.universe.type === "symbols" ? "border-cyan-700/60 bg-cyan-950/25" : "border-gray-800 bg-gray-900/50 hover:border-gray-700"}`}><span className="block text-xs font-semibold text-gray-200">A ticker list</span><span className="mt-1 block text-[9px] leading-4 text-gray-500">Stocks or ETFs you choose</span></button></div>
              {draft.universe.type === "symbols" && <div className="mt-3"><label className="text-[9px] font-semibold text-gray-500">Tickers, separated by commas</label><input value={draft.universe.symbols.join(", ")} onChange={(event) => updateDraft((current) => ({ ...current, universe: { ...current.universe, symbols: event.target.value.toUpperCase().split(/[\s,]+/).filter(Boolean).slice(0, 50) } }))} className="mt-1.5 w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-300 outline-none focus:border-cyan-700" /></div>}
            </PlanStep>

            <PlanStep number="2" title="Only consider investments that pass every check" tone="amber">
              <div className="space-y-2">{draft.rules.map((rule, index) => <div key={rule.id} className="flex items-start gap-3 rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-3"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" /><div className="min-w-0 flex-1"><p className="text-[11px] leading-5 text-gray-300">{rule.label || explainRule(rule)}</p><p className="mt-0.5 text-[9px] text-gray-600">Fixed rule. Ori cannot override it.</p></div>{draft.rules.length > 1 && <button type="button" onClick={() => updateDraft((current) => ({ ...current, rules: current.rules.filter((_, ruleIndex) => ruleIndex !== index) }))} className="text-[9px] text-gray-600 hover:text-red-400" aria-label="Remove rule">Remove</button>}</div>)}</div>
              <p className="mt-3 text-[10px] leading-4 text-gray-600">Want another check, such as RSI, moving average, valuation, or drawdown? Ask Ori above in normal language.</p>
            </PlanStep>

            <PlanStep number="3" title="React when special conditions appear" tone="cyan">
              {draft.branches.length ? <div className="space-y-2">{draft.branches.map((branch, index) => <div key={branch.id} className="rounded-xl border border-cyan-900/30 bg-gray-950/60 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-wider text-cyan-400">When {index + 1}</p><p className="mt-1 text-xs font-semibold text-gray-300">{branch.name}</p></div><button type="button" onClick={() => updateDraft((current) => ({ ...current, branches: current.branches.filter((_, branchIndex) => branchIndex !== index) }))} className="text-[9px] text-gray-600 hover:text-red-400">Remove</button></div><p className="mt-2 text-[10px] leading-4 text-gray-500">If {branch.match === "any" ? "any" : "all"} of these are true: {branch.conditions.map((condition) => condition.label || explainRule(condition)).join("; ")}</p><p className="mt-2 text-[10px] font-semibold text-amber-300">Then {branch.action === "exclude" ? "do not buy it" : `${branch.action} it to ${Number(branch.multiplier).toFixed(2)}x its normal weight`}.</p></div>)}</div> : <div className="rounded-xl border border-dashed border-gray-800 px-4 py-5 text-center"><p className="text-xs text-gray-400">No special reactions yet</p><p className="mt-1 text-[10px] text-gray-600">Eligible investments keep their normal weight.</p></div>}
              <p className="mt-3 text-[10px] leading-4 text-gray-600">Ask Ori to add reactions like “move to cash after a 12% drawdown” or “reduce weight when volatility spikes.”</p>
            </PlanStep>

            <PlanStep number="4" title="Choose the best opportunities" badge={draft.limits.allowOri ? "ori" : "rule"}>
              <p className="text-xs leading-5 text-gray-400">First, rank the investments that survived by <span className="font-semibold text-gray-200">{rankingLabel.toLowerCase()}</span>{STRATEGY_METRICS[draft.ranking.primary]?.supportsLookback ? ` over ${draft.ranking.lookbackDays} trading days` : ""}.</p>
              <div className={`mt-3 rounded-xl border p-3 ${draft.limits.allowOri ? "border-cyan-900/45 bg-cyan-950/15" : "border-gray-800 bg-gray-950/60"}`}><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={draft.limits.allowOri} onChange={(event) => { if (event.target.checked && !canUseOri) { onUpgrade?.(); return; } updateDraft((current) => ({ ...current, limits: { ...current.limits, allowOri: event.target.checked, oriRole: event.target.checked ? (current.limits.oriRole.startsWith("Off.") ? "Rank eligible investments and break close calls" : current.limits.oriRole) : "Off. Fixed rules decide every allocation" } })); }} className="mt-0.5 accent-cyan-500" /><span><span className="block text-[11px] font-semibold text-gray-200">Let Ori judge the finalists</span><span className="mt-1 block text-[9px] leading-4 text-gray-500">Ori may reorder only investments that passed every fixed rule. It cannot change exclusions or safety limits.</span></span></label>{draft.limits.allowOri && <p className="mt-2 border-t border-cyan-900/30 pt-2 text-[10px] leading-4 text-cyan-200/70">{draft.limits.oriRole}. Ori stands aside below {draft.limits.minOriConfidence}% confidence.</p>}</div>
            </PlanStep>
          </main>

          <aside className="min-w-0 space-y-4">
            <section className="min-w-0 rounded-2xl border border-emerald-900/40 bg-emerald-950/10 p-4"><div className="flex items-center gap-2"><Icon name="shield" className="h-4 w-4 text-emerald-400" /><h3 className="text-sm font-semibold text-gray-100">Safety limits</h3></div><p className="mt-1 text-[10px] leading-4 text-gray-500">These are always fixed rules, even when Ori helps.</p><div className="mt-4 space-y-3">
              <label htmlFor="strategy-rebalance" className="block"><span className="text-[9px] font-semibold text-gray-500">Check the market</span><select id="strategy-rebalance" value={draft.limits.rebalance} onChange={(event) => updateDraft((current) => ({ ...current, limits: { ...current.limits, rebalance: event.target.value } }))} className="mt-1.5 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-300 outline-none focus:border-cyan-700">{["Daily", "Weekly", "Every 2 weeks", "Monthly", "Quarterly"].map((value) => <option key={value}>{value}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-2"><label htmlFor="strategy-max-positions" className="min-w-0"><span className="text-[9px] font-semibold text-gray-500">Most holdings</span><input id="strategy-max-positions" type="number" min="1" max="20" value={draft.limits.maxPositions} onChange={(event) => updateDraft((current) => ({ ...current, limits: { ...current.limits, maxPositions: event.target.value } }))} className="mt-1.5 w-full min-w-0 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-300 outline-none focus:border-cyan-700" /></label><label htmlFor="strategy-max-position" className="min-w-0"><span className="text-[9px] font-semibold text-gray-500">Max per holding</span><div className="relative mt-1.5 min-w-0"><input id="strategy-max-position" type="number" min="3" max="100" value={draft.limits.maxPositionPct} onChange={(event) => updateDraft((current) => ({ ...current, limits: { ...current.limits, maxPositionPct: event.target.value } }))} className="w-full min-w-0 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 pr-7 text-xs text-gray-300 outline-none focus:border-cyan-700" /><span aria-hidden="true" className="pointer-events-none absolute right-3 top-2 text-xs text-gray-600">%</span></div></label></div>
              <label htmlFor="strategy-cash-reserve" className="block"><span className="text-[9px] font-semibold text-gray-500">Always keep in cash</span><div className="relative mt-1.5"><input id="strategy-cash-reserve" type="number" min="0" max="90" value={draft.limits.cashReservePct} onChange={(event) => updateDraft((current) => ({ ...current, limits: { ...current.limits, cashReservePct: event.target.value } }))} className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 pr-7 text-xs text-gray-300 outline-none focus:border-cyan-700" /><span aria-hidden="true" className="absolute right-3 top-2 text-xs text-gray-600">%</span></div></label>
              <label htmlFor="strategy-starting-cash" className="block"><span className="text-[9px] font-semibold text-gray-500">Starting paper money</span><input id="strategy-starting-cash" type="number" min="1000" step="1000" value={draft.paper.startingCash} onChange={(event) => updateDraft((current) => ({ ...current, paper: { ...current.paper, startingCash: event.target.value, cash: current.paper.holdings.length ? current.paper.cash : event.target.value } }))} disabled={!isNew || draft.paper.holdings.length > 0} className="mt-1.5 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-300 outline-none focus:border-cyan-700 disabled:opacity-50" /></label>
            </div><div className="mt-4 rounded-xl border border-emerald-900/30 bg-gray-950/50 p-3 text-[10px] leading-4 text-gray-500"><p className="font-semibold text-emerald-300">What this means</p><p className="mt-1">{universeText}. Hold up to {draft.limits.maxPositions}, never put more than {draft.limits.maxPositionPct}% in one, and keep at least {draft.limits.cashReservePct}% in cash.</p></div></section>

            <button type="button" onClick={() => setShowAdvanced(true)} className="w-full rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-3 text-left transition hover:border-gray-700"><span className="flex items-center justify-between text-[10px] font-semibold text-gray-400"><span>Advanced: view or edit YAML</span><Icon name="chevron" className="h-3 w-3" /></span><span className="mt-1 block text-[9px] leading-4 text-gray-600">Optional. The visual plan above is enough for normal use.</span></button>
          </aside>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-gray-800 bg-gray-950/80 px-5 py-4 sm:px-6"><div className="hidden items-center gap-2 text-[10px] text-gray-500 sm:flex"><SimulatedBadge /><span>No real orders can be placed.</span></div><div className="ml-auto flex gap-2"><button onClick={onCancel} className="rounded-lg border border-gray-700 px-4 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">Cancel</button><button onClick={() => onSave(normalizeStrategy(draft))} disabled={!draft.name.trim() || (draft.universe.type === "symbols" && !draft.universe.symbols.length)} className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">{isNew ? "Save paper strategy" : "Save changes"}</button></div></footer>
    </div>
  </div>;
}

function AllocationCard({ strategy, stocks }) {
  const allocations = strategy.lastDecision?.allocations || [];
  const stockMap = new Map(stocks.map((stock) => [stock.symbol, stock]));
  if (!allocations.length) return <div className="rounded-2xl border border-dashed border-gray-800 px-5 py-10 text-center"><Icon name="cash" className="mx-auto h-7 w-7 text-gray-600" /><p className="mt-3 text-sm font-medium text-gray-300">Holding simulated cash</p><p className="mt-1 text-xs text-gray-500">Run the first check to find positions that pass every rule.</p></div>;
  const used = allocations.reduce((sum, item) => sum + item.targetPct, 0);
  return (
    <div className="space-y-3">
      {allocations.map((allocation) => {
        const stock = stockMap.get(allocation.symbol);
        return (
          <div key={allocation.symbol} className="group rounded-xl border border-gray-800 bg-gray-950/55 p-3.5">
            <div className="flex items-center gap-3"><span className="w-12 font-mono text-sm font-bold text-gray-100">{allocation.symbol}</span><div className="min-w-0 flex-1"><div className="mb-1.5 flex items-center justify-between gap-3"><span className="truncate text-[11px] text-gray-500">{stock?.name || allocation.name}</span><span className="font-mono text-xs font-semibold text-gray-200">{allocation.targetPct.toFixed(1)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-gray-800"><div className={`h-full rounded-full ${allocation.source === "ori" ? "bg-cyan-500" : "bg-amber-500"}`} style={{ width: `${Math.min(100, allocation.targetPct / strategy.limits.maxPositionPct * 100)}%` }} /></div></div><SourceBadge source={allocation.source} compact /></div>
            {(allocation.branch || allocation.rationale) && <div className="mt-2 space-y-1 border-t border-gray-800/70 pt-2 text-[10px] leading-4 text-gray-500">{allocation.branch && <><p><span className="font-semibold text-amber-400">Fixed branch:</span> {allocation.branch} ({Number(allocation.weightMultiplier || 1).toFixed(2)}x starting weight)</p>{allocation.branchReason && <p><span className="font-semibold text-gray-400">Matched because:</span> {allocation.branchReason}</p>}</>}{allocation.rationale && <p><span className="font-semibold text-cyan-400">Why Ori ranked it:</span> {allocation.rationale}</p>}</div>}
          </div>
        );
      })}
      <div className="flex items-center gap-3 px-1"><span className="w-12 font-mono text-xs font-semibold text-gray-500">CASH</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-800"><div className="h-full rounded-full bg-blue-500/70" style={{ width: `${Math.max(6, 100 - used)}%` }} /></div><span className="font-mono text-xs text-gray-500">{(100 - used).toFixed(1)}%</span></div>
    </div>
  );
}

function DecisionBoundary({ strategy }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/55">
      <div className="border-b border-gray-800 px-4 py-3"><div className="flex items-center gap-2"><Icon name="shield" className="h-4 w-4 text-emerald-400" /><h3 className="text-sm font-semibold text-gray-200">How decisions stay controlled</h3></div><p className="mt-1 text-[10px] text-gray-500">The parts automation cannot change.</p></div>
      <div className="space-y-0 px-4 py-2">
        <div className="flex gap-3 border-b border-gray-800/70 py-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-300">1</span><div><SourceBadge source="rule" compact /><p className="mt-1.5 text-[11px] leading-4 text-gray-400">An investment must pass all {strategy.rules.length} required check{strategy.rules.length === 1 ? "" : "s"} before it can be bought.</p></div></div>
        <div className="flex gap-3 border-b border-gray-800/70 py-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-300">2</span><div><SourceBadge source="rule" compact /><p className="mt-1.5 text-[11px] leading-4 text-gray-400">{strategy.branches?.length ? `${strategy.branches.length} special situation${strategy.branches.length === 1 ? "" : "s"} may reduce, increase, or reject an investment.` : "No special reactions are configured; eligible investments keep normal weight."}</p></div></div>
        <div className="flex gap-3 border-b border-gray-800/70 py-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-[10px] font-bold text-cyan-300">3</span><div><SourceBadge source={strategy.limits.allowOri ? "ori" : "rule"} compact /><p className="mt-1.5 text-[11px] leading-4 text-gray-400">{strategy.limits.allowOri ? "Ori may rank only the investments that remain. It cannot put a rejected one back." : "A fixed score ranks the investments that remain."}</p></div></div>
        <div className="flex gap-3 py-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-300">4</span><div><SourceBadge source="rule" compact /><p className="mt-1.5 text-[11px] leading-4 text-gray-400">Never more than {strategy.limits.maxPositionPct}% in one holding; always at least {strategy.limits.cashReservePct}% in cash.</p></div></div>
      </div>
    </div>
  );
}

function ActivityList({ activity, limit }) {
  const events = (activity || []).slice(0, limit || activity.length);
  if (!events.length) return <p className="py-8 text-center text-xs text-gray-500">No decisions recorded yet.</p>;
  return <div className="divide-y divide-gray-800/80">{events.map((event) => <div key={event.id} className="grid gap-2 py-4 sm:grid-cols-[130px_1fr]"><div><SourceBadge source={event.source} compact /><p className="mt-1.5 text-[9px] text-gray-600">{dateTime(event.at)}</p></div><div><p className="text-xs font-semibold text-gray-200">{event.action}</p><p className="mt-1 text-[11px] leading-5 text-gray-500">{event.explanation}</p>{event.confidence != null && <p className="mt-1 text-[10px] text-cyan-400">Ori confidence: {event.confidence}%</p>}</div></div>)}</div>;
}

function SignalStatusCard({ rows = [] }) {
  if (!rows.length) return null;
  const stale = rows.filter((row) => !row.usable);
  const live = rows.filter((row) => row.usable);
  return <div className={`rounded-2xl border p-4 ${stale.length ? "border-amber-900/45 bg-amber-950/10" : "border-emerald-900/45 bg-emerald-950/10"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Icon name={stale.length ? "alert" : "check"} className={`h-4 w-4 ${stale.length ? "text-amber-400" : "text-emerald-400"}`} /><h3 className="text-xs font-semibold text-gray-200">FMP market-context inputs</h3></div><p className="mt-1 text-[10px] leading-4 text-gray-500">{live.length} usable source{live.length === 1 ? "" : "s"}. {stale.length ? `${stale.length} historical source${stale.length === 1 ? " is" : "s are"} stale or unavailable and were ignored by rule evaluation.` : "All requested sources were current enough for rule evaluation."}</p></div><span className="rounded-full border border-gray-700 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-gray-500">Starter-aware</span></div>{stale.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{stale.slice(0, 8).map((row) => <span key={`${row.family}:${row.name}`} className="rounded-md border border-amber-900/40 bg-gray-950/50 px-2 py-1 text-[9px] text-gray-500">{row.name}: {row.asOf || "unavailable"}</span>)}</div>}</div>;
}

function BranchExclusionsCard({ rows = [] }) {
  if (!rows.length) return null;
  return <div className="overflow-hidden rounded-2xl border border-red-900/40 bg-red-950/10"><div className="flex items-start gap-3 border-b border-red-900/30 px-5 py-4"><Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-red-400" /><div><h3 className="text-xs font-semibold text-gray-200">Excluded by fixed branches</h3><p className="mt-1 text-[10px] leading-4 text-gray-500">These assets passed every eligibility filter, then matched a non-overridable THEN exclude branch.</p></div></div><div className="divide-y divide-red-900/20">{rows.map((row) => <div key={`${row.symbol}:${row.allocationBranch}`} className="grid gap-1 px-5 py-3 sm:grid-cols-[90px_180px_1fr]"><span className="font-mono text-xs font-bold text-gray-200">{row.symbol}</span><span className="text-[10px] font-semibold text-red-300">{row.allocationBranch}</span><span className="text-[10px] leading-4 text-gray-500">{row.branchReason}</span></div>)}</div></div>;
}

function PerformanceChart({ backtest }) {
  const series = backtest?.series || [];
  if (series.length < 2) return null;
  const width = 760;
  const height = 220;
  const values = series.flatMap((point) => [point.value, point.benchmark]).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const line = (key) => series.map((point, index) => `${(index / (series.length - 1)) * width},${height - ((point[key] - min) / range) * height}`).join(" ");
  const hasBenchmark = series[0].benchmark != null;
  return <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950/60 p-3"><div className="mb-3 flex items-center gap-4 text-[10px]"><span className="flex items-center gap-1.5 text-cyan-300"><i className="h-0.5 w-4 bg-cyan-400" /> Strategy basket</span>{hasBenchmark && <span className="flex items-center gap-1.5 text-gray-500"><i className="h-0.5 w-4 bg-gray-600" /> Benchmark</span>}</div><svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" preserveAspectRatio="none"><defs><linearGradient id="strategyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity="0.22" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></linearGradient></defs><path d={`M0,${height} L${line("value")} L${width},${height} Z`} fill="url(#strategyFill)" />{hasBenchmark && <polyline points={line("benchmark")} fill="none" stroke="#4b5563" strokeWidth="2" vectorEffect="non-scaling-stroke" />}<polyline points={line("value")} fill="none" stroke="#22d3ee" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg></div>;
}

function StrategyWorkspace({ strategy, stocks, store, onEdit, onBack, onDelete }) {
  const [tab, setTab] = useState("overview");
  const [backtesting, setBacktesting] = useState(false);
  const [backtestError, setBacktestError] = useState("");
  const running = store.runningStrategyIds.includes(strategy.id);
  useEffect(() => setTab("overview"), [strategy.id]);
  const prices = useMemo(() => Object.fromEntries(stocks.map((stock) => [stock.symbol, stock.price])), [stocks]);
  const accountValue = paperAccountValue(strategy.paper, prices);
  const paperReturn = accountValue / strategy.paper.startingCash - 1;

  function toggleMonitoring() {
    const monitoring = strategy.status !== "monitoring";
    store.updateStrategy(strategy.id, {
      status: monitoring ? "monitoring" : "paused",
      nextRunAt: monitoring ? nextRunDate(strategy.limits.rebalance) : null,
      activity: [makeActivity("system", monitoring ? "Monitoring started" : "Monitoring paused", monitoring ? `Orizin will run a paper check every ${strategy.limits.rebalance.toLowerCase()} while the app is open. No real orders can be sent.` : "Scheduled paper checks are paused. Existing simulated holdings were not changed."), ...(strategy.activity || [])],
    });
  }

  async function runBacktest() {
    const allocations = strategy.lastDecision?.allocations || [];
    if (!allocations.length) { setBacktestError("Run a strategy check first so there is a rule-approved basket to simulate."); return; }
    setBacktesting(true);
    setBacktestError("");
    try {
      const symbols = [...new Set([...allocations.map((item) => item.symbol), strategy.benchmark || "SPY"])];
      const rows = await Promise.all(symbols.map(async (symbol) => {
        const response = await fetch(`/api/stocks/sparkline/${encodeURIComponent(symbol)}?days=504&maxAgeHours=24`);
        if (!response.ok) return [symbol, []];
        const data = await response.json();
        return [symbol, data.prices || []];
      }));
      const history = Object.fromEntries(rows);
      const missingHistory = allocations.filter((allocation) => (history[allocation.symbol] || []).length < 20).map((allocation) => allocation.symbol);
      if (missingHistory.length) throw new Error(`Price history is unavailable for ${missingHistory.join(", ")}. The simulation was not run on a partial basket.`);
      const result = buildHistoricalSimulation(history, allocations, history[strategy.benchmark || "SPY"] || [], strategy.paper.startingCash);
      if (!result) throw new Error("There is not enough price history for the current basket yet.");
      store.updateStrategy(strategy.id, { backtest: result, activity: [makeActivity("system", "Historical simulation completed", `Tested today's approved ${result.symbols.join(", ")} basket across ${result.days} available daily closes. This did not reconstruct past signals.`), ...(strategy.activity || [])] });
    } catch (error) {
      setBacktestError(error.message);
    } finally {
      setBacktesting(false);
    }
  }

  const tabs = [{ id: "overview", label: "Now" }, { id: "logic", label: "Plan" }, { id: "backtest", label: "Test history" }, { id: "activity", label: "Why log" }];
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-gray-950">
      <div className="shrink-0 border-b border-gray-800 bg-gray-950 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><button onClick={onBack} className="rounded-lg border border-gray-800 p-1.5 text-gray-500 hover:bg-gray-900 hover:text-gray-200 lg:hidden"><Icon name="back" className="h-4 w-4" /></button><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-lg font-semibold tracking-tight text-gray-100" style={BRAND_FONT}>{strategy.name}</h1><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${strategy.status === "monitoring" ? "bg-emerald-500/15 text-emerald-400" : "bg-gray-800 text-gray-500"}`}>{strategy.status === "monitoring" ? "Monitoring" : "Paused"}</span><SimulatedBadge /></div><p className="mt-0.5 truncate text-[11px] text-gray-500">{strategy.description}</p></div></div>
          <div className="flex items-center gap-2"><button onClick={onEdit} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:bg-gray-900 hover:text-gray-200" title="Edit strategy"><Icon name="edit" className="h-3.5 w-3.5" /></button><button onClick={onDelete} className="rounded-lg border border-gray-800 p-2 text-gray-600 hover:border-red-900/60 hover:bg-red-950/20 hover:text-red-400" title="Delete strategy"><Icon name="trash" className="h-3.5 w-3.5" /></button><button onClick={toggleMonitoring} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${strategy.status === "monitoring" ? "border-gray-700 text-gray-300 hover:bg-gray-900" : "border-emerald-700/60 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/30"}`}><Icon name={strategy.status === "monitoring" ? "pause" : "play"} className="h-3.5 w-3.5" />{strategy.status === "monitoring" ? "Pause" : "Monitor"}</button><button onClick={() => store.runStrategy(strategy.id)} disabled={running} className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">{running ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Icon name="play" className="h-3.5 w-3.5" />}{running ? "Checking..." : "Check now"}</button></div>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto">{tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${tab === item.id ? "bg-gray-800 text-gray-100" : "text-gray-500 hover:text-gray-300"}`}>{item.label}{item.id === "activity" && strategy.activity.length > 0 ? ` (${Math.min(99, strategy.activity.length)})` : ""}</button>)}</div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        {tab === "overview" && <div className="mx-auto max-w-6xl space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[{ label: "Paper account", value: money(accountValue), sub: percent(paperReturn), tone: paperReturn >= 0 ? "text-emerald-400" : "text-red-400" }, { label: "Current positions", value: String(strategy.paper.holdings.length), sub: `${money(strategy.paper.cash)} cash`, tone: "text-gray-100" }, { label: "Last check", value: shortDate(strategy.lastRunAt), sub: strategy.lastDecision ? `${strategy.lastDecision.eligibleCount} eligible` : "Waiting for first run", tone: "text-gray-100" }, { label: "Next check", value: strategy.status === "monitoring" ? shortDate(strategy.nextRunAt) : "Paused", sub: strategy.limits.rebalance, tone: strategy.status === "monitoring" ? "text-cyan-300" : "text-gray-500" }].map((metric) => <div key={metric.label} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4"><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-600">{metric.label}</p><p className={`mt-2 truncate text-lg font-semibold tabular-nums ${metric.tone}`}>{metric.value}</p><p className={`mt-0.5 text-[10px] ${metric.label === "Paper account" ? metric.tone : "text-gray-500"}`}>{metric.sub}</p></div>)}
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(270px,0.8fr)]">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/45 p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-gray-200">Current paper allocation</h2><p className="mt-0.5 text-[10px] text-gray-500">Targets from the latest completed check.</p></div>{strategy.lastDecision && <span className="text-[10px] text-gray-600">{dateTime(strategy.lastDecision.at)}</span>}</div><AllocationCard strategy={strategy} stocks={stocks} /></div>
            <DecisionBoundary strategy={strategy} />
          </div>
          {strategy.lastDecision && <details className="group overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/30"><summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4"><span><span className="block text-xs font-semibold text-gray-300">Data behind this decision</span><span className="mt-1 block text-[10px] text-gray-600">Signals, rejected investments, and technical measurements</span></span><Icon name="chevron" className="h-3.5 w-3.5 text-gray-600 transition group-open:rotate-90" /></summary><div className="space-y-4 border-t border-gray-800 p-4 sm:p-5">
          <SignalStatusCard rows={strategy.lastDecision?.signalStatus || []} />
          <BranchExclusionsCard rows={strategy.lastDecision?.branchExclusions || []} />
          {strategy.lastDecision?.candidates?.length > 0 && <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/45">
            <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3"><div><h2 className="text-sm font-semibold text-gray-200">Latest allocation set</h2><p className="mt-0.5 text-[10px] text-gray-500">Every name passed eligibility filters and was not excluded by a conditional branch.</p></div><SourceBadge source="rule" /></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-gray-950/40 text-[9px] uppercase tracking-wider text-gray-600"><tr><th className="px-5 py-2.5 font-semibold">Symbol</th><th className="px-3 py-2.5 font-semibold">Sector</th><th className="px-3 py-2.5 text-right font-semibold">Conviction</th><th className="px-3 py-2.5 text-right font-semibold">RSI 14</th><th className="px-3 py-2.5 text-right font-semibold">63d return</th><th className="px-3 py-2.5 text-right font-semibold">Avg return</th><th className="px-3 py-2.5 text-right font-semibold">Ann. vol</th><th className="px-3 py-2.5 text-right font-semibold">Max DD</th><th className="px-5 py-2.5 font-semibold">Matched branch</th></tr></thead><tbody className="divide-y divide-gray-800">{strategy.lastDecision.candidates.map((candidate) => <tr key={candidate.symbol}><td className="px-5 py-3 font-mono font-bold text-gray-200">{candidate.symbol}</td><td className="px-3 py-3 text-gray-500">{candidate.sector || "-"}</td><td className="px-3 py-3 text-right tabular-nums text-gray-300">{candidate.conviction != null ? Math.round(candidate.conviction) : "-"}</td><td className="px-3 py-3 text-right tabular-nums text-gray-400">{candidate.rsi14 != null ? Math.round(candidate.rsi14) : "-"}</td><td className={`px-3 py-3 text-right tabular-nums ${candidate.momentum90 >= 0 ? "text-emerald-400" : "text-red-400"}`}>{candidate.momentum90 != null ? percent(candidate.momentum90) : "-"}</td><td className="px-3 py-3 text-right tabular-nums text-gray-400">{candidate.averageReturn != null ? percent(candidate.averageReturn, 2) : "-"}</td><td className="px-3 py-3 text-right tabular-nums text-gray-400">{candidate.annualizedVolatility != null ? percent(candidate.annualizedVolatility) : "-"}</td><td className="px-3 py-3 text-right tabular-nums text-red-400">{candidate.maxDrawdown != null ? percent(candidate.maxDrawdown) : "-"}</td><td className="max-w-[280px] px-5 py-3 text-[10px] text-gray-500">{candidate.allocationBranch ? <><p className="font-semibold text-amber-300">{candidate.allocationBranch} ({Number(candidate.weightMultiplier || 1).toFixed(2)}x)</p>{candidate.branchReason && <p className="mt-1 leading-4">{candidate.branchReason}</p>}</> : "ELSE: normal weight"}</td></tr>)}</tbody></table></div>
          </div>}
          </div></details>}
          <div className="rounded-2xl border border-gray-800 bg-gray-900/45 px-5"><div className="flex items-center justify-between border-b border-gray-800 py-3"><div><h2 className="text-sm font-semibold text-gray-200">What happened and why</h2><p className="mt-0.5 text-[10px] text-gray-500">Each event identifies its decision source.</p></div><button onClick={() => setTab("activity")} className="text-[10px] font-semibold text-cyan-400 hover:text-cyan-300">View all</button></div><ActivityList activity={strategy.activity} limit={5} /></div>
        </div>}

        {tab === "logic" && <div className="mx-auto max-w-4xl space-y-5">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-600">Plain-English decision tree</p><h2 className="mt-1 text-lg font-semibold text-gray-100">How {strategy.name} thinks</h2><p className="mt-2 text-xs leading-5 text-gray-500">The process runs top to bottom. Missing or stale data never passes a condition, and a later step cannot undo an earlier exclusion.</p></div><button onClick={onEdit} className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800"><Icon name="edit" className="h-3 w-3" /> Edit logic</button></div></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-gray-400">1</span><div><SourceBadge source="rule" compact /><h3 className="mt-1 text-sm font-semibold text-gray-200">Start with the universe</h3></div></div><p className="mt-3 text-xs leading-5 text-gray-500">{strategy.universe.type === "symbols" ? `Only ${strategy.universe.symbols.join(", ")} can be considered.` : `Consider tracked ${strategy.universe.includeEtfs ? "stocks and ETFs" : "stocks only"}${strategy.universe.sectors?.length ? ` in ${strategy.universe.sectors.join(", ")}` : ""}.`}</p></div>
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-gray-400">2</span><div><SourceBadge source="rule" compact /><h3 className="mt-1 text-sm font-semibold text-gray-200">Apply every eligibility filter</h3></div></div><div className="mt-3 space-y-2">{strategy.rules.map((rule) => <div key={rule.id} className="flex gap-2 rounded-lg bg-gray-950/60 px-3 py-2 text-[11px] text-gray-400"><Icon name="check" className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" /><span>{rule.label || explainRule(rule)}</span></div>)}</div></div>
            <div className="rounded-2xl border border-cyan-900/40 bg-cyan-950/10 p-5 sm:col-span-2"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/15 text-xs font-bold text-cyan-300">3</span><div><SourceBadge source="rule" compact /><h3 className="mt-1 text-sm font-semibold text-gray-200">Evaluate ordered WHEN / THEN branches</h3></div></div>{strategy.branches?.length ? <div className="mt-4 space-y-3">{strategy.branches.map((branch, index) => <div key={branch.id} className="grid gap-2 rounded-xl border border-gray-800 bg-gray-950/55 p-3 sm:grid-cols-[70px_1fr_150px]"><span className="text-[9px] font-bold uppercase tracking-wider text-cyan-400">WHEN {index + 1}</span><div><p className="text-xs font-semibold text-gray-300">{branch.name}</p><p className="mt-1 text-[10px] leading-4 text-gray-500">Match {branch.match === "any" ? "ANY" : "ALL"}: {branch.conditions.map((condition) => condition.label || explainRule(condition)).join("; ")}</p></div><p className="text-[10px] font-semibold text-amber-300">THEN {branch.action === "exclude" ? "exclude" : `${branch.action} at ${Number(branch.multiplier).toFixed(2)}x`}</p></div>)}</div> : <p className="mt-3 text-xs text-gray-500">No branches. ELSE applies normal weight to every eligible asset.</p>}<p className="mt-3 text-[10px] text-gray-600">ELSE: keep normal weight. First matching branch wins.</p></div>
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-gray-400">4</span><div><SourceBadge source={strategy.limits.allowOri ? "ori" : "rule"} compact /><h3 className="mt-1 text-sm font-semibold text-gray-200">Rank remaining assets</h3></div></div><p className="mt-3 text-xs leading-5 text-gray-500">Rank by {STRATEGY_METRICS[strategy.ranking.primary]?.label || strategy.ranking.primary}{STRATEGY_METRICS[strategy.ranking.primary]?.supportsLookback ? ` over ${strategy.ranking.lookbackDays} trading days` : ""}. {strategy.limits.allowOri ? `${strategy.limits.oriRole}. Ori stands aside below ${strategy.limits.minOriConfidence}% confidence. Brief: ${strategy.oriBrief}` : "No AI judgment is used."}</p></div>
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-gray-400">5</span><div><SourceBadge source="rule" compact /><h3 className="mt-1 text-sm font-semibold text-gray-200">Enforce portfolio limits</h3></div></div><p className="mt-3 text-xs leading-5 text-gray-500">Hold at most {strategy.limits.maxPositions} positions, cap each at {strategy.limits.maxPositionPct}%, and reserve at least {strategy.limits.cashReservePct}% in simulated cash. Review {strategy.limits.rebalance.toLowerCase()}.</p></div>
          </div>
        </div>}

        {tab === "backtest" && <div className="mx-auto max-w-5xl space-y-5"><div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-gray-800 bg-gray-900/50 p-5"><div><div className="flex items-center gap-2"><Icon name="chart" className="h-4 w-4 text-cyan-400" /><h2 className="text-base font-semibold text-gray-100">Historical simulation</h2></div><p className="mt-2 max-w-2xl text-xs leading-5 text-gray-500">Tests today's rule-approved basket against available daily closes. This is useful for a first pressure test, but it does not pretend the app stored and replayed past rules or Ori calls.</p></div><button onClick={runBacktest} disabled={backtesting} className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">{backtesting ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Icon name="play" className="h-3.5 w-3.5" />}{backtesting ? "Loading history..." : strategy.backtest ? "Run again" : "Run simulation"}</button></div>{backtestError && <div className="rounded-xl border border-red-900/50 bg-red-950/25 px-4 py-3 text-xs text-red-300">{backtestError}</div>}{strategy.backtest && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[{ label: "Total return", value: percent(strategy.backtest.metrics.totalReturn), good: strategy.backtest.metrics.totalReturn >= 0 }, { label: "Annualized", value: percent(strategy.backtest.metrics.annualizedReturn), good: strategy.backtest.metrics.annualizedReturn >= 0 }, { label: "Max drawdown", value: percent(strategy.backtest.metrics.maxDrawdown), good: false }, { label: "Volatility", value: percent(strategy.backtest.metrics.volatility), neutral: true }, { label: `${strategy.benchmark} return`, value: strategy.backtest.metrics.benchmarkReturn == null ? "-" : percent(strategy.backtest.metrics.benchmarkReturn), neutral: true }].map((item) => <div key={item.label} className="rounded-xl border border-gray-800 bg-gray-900/45 p-4"><p className="text-[9px] font-bold uppercase tracking-wider text-gray-600">{item.label}</p><p className={`mt-2 text-lg font-semibold tabular-nums ${item.neutral ? "text-gray-200" : item.good ? "text-emerald-400" : "text-red-400"}`}>{item.value}</p></div>)}</div><PerformanceChart backtest={strategy.backtest} /><div className="flex gap-3 rounded-xl border border-amber-900/40 bg-amber-950/15 p-4"><Icon name="alert" className="h-4 w-4 shrink-0 text-amber-400" /><div><p className="text-xs font-semibold text-amber-300">Read this result correctly</p><p className="mt-1 text-[11px] leading-5 text-gray-500">{strategy.backtest.methodology} It excludes fees, taxes, slippage, and past composition changes. Past performance does not predict future results.</p></div></div></>}</div>}

        {tab === "activity" && <div className="mx-auto max-w-4xl"><div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/45"><div className="border-b border-gray-800 px-5 py-4"><div className="flex items-center gap-2"><Icon name="clock" className="h-4 w-4 text-gray-400" /><h2 className="text-base font-semibold text-gray-100">Decision ledger</h2></div><p className="mt-1 text-xs text-gray-500">A permanent explanation of what happened, why it happened, and who decided.</p></div><div className="px-5"><ActivityList activity={strategy.activity} /></div></div></div>}
      </div>
    </div>
  );
}

function StrategySidebar({ strategies, activeId, onSelect, onDiscover }) {
  return <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-gray-800 bg-gray-900/35 lg:flex"><div className="border-b border-gray-800 p-4"><button onClick={onDiscover} className="flex w-full items-center justify-between rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-left text-xs font-semibold text-gray-200 hover:border-gray-600"><span className="flex items-center gap-2"><Icon name="plus" className="h-3.5 w-3.5 text-cyan-400" /> New strategy</span><Icon name="chevron" className="h-3 w-3 text-gray-600" /></button></div><div className="flex-1 overflow-y-auto p-2"><p className="px-2 pb-2 pt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-gray-600">Your paper strategies</p>{strategies.length === 0 ? <p className="px-2 py-5 text-xs leading-5 text-gray-600">No strategies saved yet.</p> : <div className="space-y-1">{strategies.map((strategy) => <button key={strategy.id} onClick={() => onSelect(strategy.id)} className={`w-full rounded-xl border px-3 py-3 text-left transition ${activeId === strategy.id ? "border-cyan-800/60 bg-cyan-950/20" : "border-transparent hover:border-gray-800 hover:bg-gray-900/70"}`}><div className="flex items-start justify-between gap-2"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${strategy.status === "monitoring" ? "bg-emerald-400" : "bg-gray-600"}`} /><div className="min-w-0 flex-1"><p className={`truncate text-xs font-semibold ${activeId === strategy.id ? "text-gray-100" : "text-gray-300"}`}>{strategy.name}</p><p className="mt-1 truncate text-[9px] uppercase tracking-wider text-gray-600">{strategy.limits.allowOri ? "Rules + Ori" : "Rules only"} | {strategy.limits.rebalance}</p></div></div></button>)}</div>}</div><div className="border-t border-gray-800 p-4"><div className="flex items-center gap-2 text-[10px] text-gray-600"><Icon name="shield" className="h-3.5 w-3.5" /> Paper execution only</div></div></aside>;
}

function MobileStrategyNav({ strategies, activeId, discover, onSelect, onDiscover }) {
  return <div className="flex shrink-0 items-center gap-2 border-b border-gray-800 bg-gray-900/45 px-3 py-2 lg:hidden"><button onClick={onDiscover} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${discover ? "border-cyan-700/60 bg-cyan-950/30 text-cyan-300" : "border-gray-700 text-gray-400"}`} aria-label="New strategy"><Icon name="plus" className="h-3.5 w-3.5" /></button><select value={discover ? "" : activeId || ""} onChange={(event) => event.target.value ? onSelect(event.target.value) : onDiscover()} className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-cyan-600"><option value="">Discover and create</option>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.status === "monitoring" ? "[On] " : ""}{strategy.name}</option>)}</select><SimulatedBadge /></div>;
}

export default function StrategiesPage({ strategiesStore, stocks = [], canUseOri = false, onUpgradeToPro }) {
  const store = strategiesStore;
  const [discover, setDiscover] = useState(() => !store.activeStrategy);
  const [editor, setEditor] = useState(null);
  const strategy = store.activeStrategy;

  useEffect(() => {
    if (!strategy && store.strategies.length === 0) setDiscover(true);
  }, [strategy, store.strategies.length]);

  function addPreset(presetId) {
    const created = strategyFromPreset(presetId);
    if (created.limits.allowOri && !canUseOri) {
      created.limits = { ...created.limits, allowOri: false, oriRole: "Off. Fixed rules decide every allocation" };
      created.activity = [makeActivity("system", "Preset started in rules-only mode", "Ori ranking is available on Pro. Every fixed rule and paper simulation remains available on the current plan."), ...created.activity];
    }
    if (!store.addStrategy(created)) return;
    setDiscover(false);
  }

  function saveEditor(value) {
    if (editor?.isNew) {
      if (!store.addStrategy(value)) return;
    } else {
      store.replaceStrategy(value);
    }
    setEditor(null);
    setDiscover(false);
  }

  if (!store.hydrated) return <div className="flex h-full items-center justify-center bg-gray-950 text-xs text-gray-500">Loading strategies...</div>;

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950 text-gray-100 lg:flex-row">
      <StrategySidebar strategies={store.strategies} activeId={discover ? null : store.activeStrategyId} onSelect={(id) => { store.setActiveStrategyId(id); setDiscover(false); }} onDiscover={() => setDiscover(true)} />
      <MobileStrategyNav strategies={store.strategies} activeId={store.activeStrategyId} discover={discover} onSelect={(id) => { store.setActiveStrategyId(id); setDiscover(false); }} onDiscover={() => setDiscover(true)} />
      {discover || !strategy ? <EmptyWorkspace canUseOri={canUseOri} onUpgrade={onUpgradeToPro} onAddPreset={addPreset} onOpenManual={() => setEditor({ strategy: createBlankStrategy(), isNew: true })} onOpenOri={(draft) => setEditor({ strategy: draft, isNew: true })} strategyCount={store.strategies.length} /> : <StrategyWorkspace strategy={strategy} stocks={stocks} store={store} onEdit={() => setEditor({ strategy, isNew: false })} onBack={() => setDiscover(true)} onDelete={() => { if (!window.confirm(`Delete "${strategy.name}" and its paper history?`)) return; store.deleteStrategy(strategy.id); setDiscover(true); }} />}
      {editor && <StrategyEditor initial={editor.strategy} isNew={editor.isNew} canUseOri={canUseOri} onUpgrade={onUpgradeToPro} onCancel={() => setEditor(null)} onSave={saveEditor} />}
    </div>
  );
}
