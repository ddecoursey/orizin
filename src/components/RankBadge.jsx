import { resolveRank } from "../lib/ranks.js";
import RankEmblem from "./RankEmblem.jsx";

/**
 * Shows thematic rank + familiar tier label.
 * @param {'inline'|'stacked'|'emblem'} layout
 */
export default function RankBadge({
  plan = "free",
  isAdmin = false,
  layout = "inline",
  showLabel = true,
  showTagline = false,
  size = "sm",
  className = "",
}) {
  const rank = resolveRank({ plan, isAdmin });
  const emblemClass = size === "lg" ? "w-8 h-8" : size === "md" ? "w-6 h-6" : "w-4 h-4";
  const nameClass = size === "lg" ? "text-base font-semibold" : size === "md" ? "text-sm font-semibold" : "text-xs font-semibold";

  if (layout === "emblem") {
    return (
      <span className={`inline-flex ${className}`} title={`${rank.name} (${rank.label})`}>
        <RankEmblem rankId={rank.id} className={emblemClass} />
      </span>
    );
  }

  if (layout === "stacked") {
    return (
      <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
        <RankEmblem rankId={rank.id} className={size === "lg" ? "w-10 h-10 shrink-0" : "w-8 h-8 shrink-0"} />
        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 flex-wrap ${nameClass} ${rank.accentText}`}>
            <span>{rank.name}</span>
            {showLabel && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${rank.accentBg} ${rank.accentText} border ${rank.accentBorder}`}>
                {rank.label}
              </span>
            )}
          </div>
          {showTagline && rank.tagline && (
            <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{rank.tagline}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      <RankEmblem rankId={rank.id} className={emblemClass} />
      <span className={`${nameClass} ${rank.accentText}`}>{rank.name}</span>
      {showLabel && (
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 ${rank.accentBg} ${rank.accentText} border ${rank.accentBorder}`}>
          {rank.label}
        </span>
      )}
    </span>
  );
}