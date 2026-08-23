import type { RankHistoryPoint } from "@/lib/rank-history";

type RankTrailProps = {
  category: string;
  points: RankHistoryPoint[];
  slug: string;
};

const WIDTH = 760;
const HEIGHT = 270;
const X_PAD = 54;
const Y_PAD = 34;

const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function chartPoint(
  point: RankHistoryPoint,
  maximumRank: number,
  rank: number,
  firstTimestamp: number,
  lastTimestamp: number,
): [number, number] {
  const x = firstTimestamp === lastTimestamp
    ? WIDTH / 2
    : X_PAD + ((new Date(point.capturedAt).getTime() - firstTimestamp) / (lastTimestamp - firstTimestamp)) * (WIDTH - X_PAD * 2);
  const y = rankY(rank, maximumRank);
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

function rankY(rank: number, maximumRank: number): number {
  const yRange = HEIGHT - Y_PAD * 2;
  return maximumRank === 1
    ? HEIGHT / 2
    : Y_PAD + ((rank - 1) / (maximumRank - 1)) * yRange;
}

function line(
  points: RankHistoryPoint[],
  maximumRank: number,
  rank: (point: RankHistoryPoint) => number,
  firstTimestamp: number,
  lastTimestamp: number,
): string {
  return points.map((point, index) => {
    const [x, y] = chartPoint(point, maximumRank, rank(point), firstTimestamp, lastTimestamp);
    return `${index === 0 ? "M" : "L"}${x} ${y}`;
  }).join(" ");
}

function observationLabel(point: RankHistoryPoint): string {
  return `${date.format(new Date(point.capturedAt))} UTC`;
}

export function RankTrail({ category, points, slug }: RankTrailProps) {
  const latest = points.at(-1);
  const maximumRank = Math.max(1, ...points.flatMap((point) => [point.overallRank, point.categoryRank]));
  const midRank = Math.max(1, Math.ceil(maximumRank / 2));
  const tablePoints = points.slice(-8).reverse();
  const firstTimestamp = latest ? new Date(points[0]!.capturedAt).getTime() : 0;
  const lastTimestamp = latest ? new Date(latest.capturedAt).getTime() : 0;

  return (
    <section className="rank-trail shell" aria-labelledby="rank-trail-heading">
      <div className="rank-trail-heading">
        <div>
          <span className="kicker">02 / position record</span>
          <h2 id="rank-trail-heading">Rank trail.</h2>
        </div>
        <p>Observed hourly and recorded whenever position, field size, settled total, or placement count changes—with one daily checkpoint when nothing moves.</p>
      </div>

      {latest ? (
        <div className="rank-trail-paper">
          <div className="rank-trail-cap">
            <span>Public observation docket</span>
            <code>/api/listings/{slug}/rank-history</code>
            <strong>{points.length} plotted</strong>
          </div>
          <div className="rank-trail-plot">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="rank-chart-title rank-chart-description">
              <title id="rank-chart-title">Overall and {category} category rank history</title>
              <desc id="rank-chart-description">Lower rank numbers appear higher. The newest observation is overall rank {latest.overallRank} of {latest.overallEntries} and category rank {latest.categoryRank} of {latest.categoryEntries}.</desc>
              {[1, midRank, maximumRank].filter((rank, index, values) => values.indexOf(rank) === index).map((rank) => {
                const y = rankY(rank, maximumRank);
                return <g key={rank} className="rank-grid"><line x1={X_PAD} x2={WIDTH - X_PAD} y1={y} y2={y} /><text x="8" y={y + 4}>#{rank}</text></g>;
              })}
              <path className="rank-line rank-line-overall" d={line(points, maximumRank, (point) => point.overallRank, firstTimestamp, lastTimestamp)} />
              <path className="rank-line rank-line-category" d={line(points, maximumRank, (point) => point.categoryRank, firstTimestamp, lastTimestamp)} />
              {points.map((point) => {
                const [overallX, overallY] = chartPoint(point, maximumRank, point.overallRank, firstTimestamp, lastTimestamp);
                const [, categoryY] = chartPoint(point, maximumRank, point.categoryRank, firstTimestamp, lastTimestamp);
                return (
                  <g key={point.capturedAt}>
                    <circle className="rank-dot-overall" cx={overallX} cy={overallY} r="3.5" />
                    <rect className="rank-dot-category" x={overallX - 3.5} y={categoryY - 3.5} width="7" height="7" />
                  </g>
                );
              })}
              <g className="rank-time-labels">
                <text x={X_PAD} y={HEIGHT - 4}>{observationLabel(points[0]!)}</text>
                <text x={WIDTH - X_PAD} y={HEIGHT - 4} textAnchor="end">{observationLabel(latest)}</text>
              </g>
            </svg>
            <div className="rank-trail-legend" aria-hidden="true"><span><i />Open-source rank</span><span><i />{category} rank</span><small>Better rank ↑</small></div>
          </div>
          <dl className="rank-trail-latest">
            <div><dt>Latest overall</dt><dd>#{latest.overallRank} / {latest.overallEntries}</dd></div>
            <div><dt>Latest category</dt><dd>#{latest.categoryRank} / {latest.categoryEntries}</dd></div>
            <div><dt>Observed</dt><dd>{observationLabel(latest)}</dd></div>
          </dl>
          <details className="rank-trail-table">
            <summary>Read latest observations</summary>
            <div role="table" aria-label="Latest rank observations">
              <div role="row" className="rank-trail-row rank-trail-row-head"><span role="columnheader">Observed</span><span role="columnheader">Overall</span><span role="columnheader">Category</span><span role="columnheader">Settled</span></div>
              {tablePoints.map((point) => <div role="row" className="rank-trail-row" key={point.capturedAt}><time role="cell" dateTime={point.capturedAt}>{observationLabel(point)}</time><span role="cell">#{point.overallRank} / {point.overallEntries}</span><span role="cell">#{point.categoryRank} / {point.categoryEntries}</span><span role="cell">${(point.totalCents / 100).toFixed(2)}</span></div>)}
            </div>
          </details>
        </div>
      ) : (
        <div className="rank-trail-empty">
          <strong>Awaiting the first observation.</strong>
          <p>The hourly public record begins after the next scheduled maintenance run. The live rank above remains authoritative until then.</p>
        </div>
      )}
    </section>
  );
}
