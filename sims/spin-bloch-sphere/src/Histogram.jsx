// A small, fixed two-bar histogram for the data-collection mode's
// projective measurement results -- deliberately not the general N-detector
// canvas histogram the Stern-Gerlach sim uses, since here there are always
// exactly two outcomes (+axis / -axis) and the bars are simple enough to
// lay out directly with flexbox rather than hand-rolling canvas drawing.
const BAR_AREA_HEIGHT = 110; // px, the vertical space each bar grows within

function Bar({ label, count, total, maxCount, theoryProb, showTheory, color }) {
  const heightPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const theoryHeightPct = maxCount > 0 ? ((theoryProb * total) / maxCount) * 100 : 0;
  const pct = total > 0 ? (count / total) * 100 : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: `${BAR_AREA_HEIGHT}px`,
          display: 'flex',
          alignItems: 'flex-end',
          background: '#f0f0f0',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '100%',
            height: `${heightPct}%`,
            background: color,
            transition: 'height 0.2s ease',
          }}
        />
        {showTheory && total > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: `${theoryHeightPct}%`,
              borderTop: '2px dashed #333',
            }}
            title={`Theoretical: ${(theoryProb * 100).toFixed(1)}%`}
          />
        )}
      </div>
      <div style={{ marginTop: '4px', fontSize: '0.9rem', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '0.8rem', color: '#666' }}>
        {count}
        {total > 0 ? ` (${pct.toFixed(0)}%)` : ''}
      </div>
    </div>
  );
}

// theoryProbPlus is P(measuring +axis) for the *current* preparation --
// computed by the caller from the exact Born-rule expectation value, not
// sampled, so the reference line is the true prediction rather than a
// noisy estimate.
export default function Histogram({ axisLabel, counts, showTheory, setShowTheory, theoryProbPlus, onClear }) {
  const total = counts.plus + counts.minus;
  const maxCount = Math.max(counts.plus, counts.minus, 1);

  return (
    <div className="overlay-controls">
      <h3>Measurement Histogram</h3>
      <div style={{ display: 'flex', gap: '20px', padding: '0 8px' }}>
        <Bar
          label={`|+${axisLabel}⟩`}
          count={counts.plus}
          total={total}
          maxCount={maxCount}
          theoryProb={theoryProbPlus}
          showTheory={showTheory}
          color="#0066cc"
        />
        <Bar
          label={`|−${axisLabel}⟩`}
          count={counts.minus}
          total={total}
          maxCount={maxCount}
          theoryProb={1 - theoryProbPlus}
          showTheory={showTheory}
          color="#cc0000"
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', margin: 0 }}>
          <input type="checkbox" checked={showTheory} onChange={(e) => setShowTheory(e.target.checked)} />
          Show theory
        </label>
        <span style={{ fontSize: '0.85rem', color: '#666' }}>N = {total}</span>
      </div>
      <button className="control-button" onClick={onClear} disabled={total === 0}>
        Clear Data
      </button>
    </div>
  );
}