/**
 * NumericCell — FAZA FE-3 (2026-04-26)
 *
 * Renders a numeric value with monospace tabular-numerics and graded color
 * based on magnitude (--num-up-strong/-soft/-flat/--num-down-soft/-strong).
 *
 * Color semantics (Institutional theme):
 *   value >  thresholds.strongUp    -> num-up-strong   (deep green)
 *   value >  thresholds.flat        -> num-up-soft     (soft green)
 *   |value| <= flat                 -> num-flat        (slate)
 *   value <  -thresholds.flat       -> num-down-soft   (soft red)
 *   value <  -thresholds.strongDown -> num-down-strong (deep red)
 *
 * Dragon theme falls back to --accent-green/red/text-muted via the CSS
 * variable cascade (see globals.css).
 *
 * Asumptie: caller supplies sensible thresholds for the metric semantics.
 * Default thresholds match a percentage scale (-100..+100).
 */

type Format = 'number' | 'percent' | 'pnl' | 'currency' | 'integer';

type Thresholds = {
  /** Above this magnitude → strong color. Default 1.0 (1% for percent format). */
  strongUp?: number;
  strongDown?: number;
  /** Below this magnitude (absolute) → flat / neutral. Default 0.05. */
  flat?: number;
};

type Props = {
  value: number | null | undefined;
  format?: Format;
  decimals?: number;
  thresholds?: Thresholds;
  /** Force color regardless of value (escape hatch). */
  forceColor?: 'up-strong' | 'up-soft' | 'flat' | 'down-soft' | 'down-strong';
  /** Append unit suffix (e.g. "x", "USD"). */
  suffix?: string;
  /** Show explicit "+" for positive values. Default true for pnl/percent. */
  showSign?: boolean;
  className?: string;
};

const colorVarMap: Record<NonNullable<Props['forceColor']>, string> = {
  'up-strong':   'var(--num-up-strong,   var(--accent-green))',
  'up-soft':     'var(--num-up-soft,     var(--accent-green))',
  'flat':        'var(--num-flat,        var(--text-muted))',
  'down-soft':   'var(--num-down-soft,   var(--accent-red))',
  'down-strong': 'var(--num-down-strong, var(--accent-red))',
};

function classify(v: number, t: Required<Thresholds>): keyof typeof colorVarMap {
  if (Math.abs(v) <= t.flat) return 'flat';
  if (v >= t.strongUp) return 'up-strong';
  if (v > 0) return 'up-soft';
  if (v <= -t.strongDown) return 'down-strong';
  return 'down-soft';
}

function formatValue(v: number, fmt: Format, decimals: number, showSign: boolean): string {
  const sign = v > 0 && showSign ? '+' : '';
  switch (fmt) {
    case 'percent': return `${sign}${v.toFixed(decimals)}%`;
    case 'pnl':     return `${sign}${v.toFixed(decimals)}`;
    case 'currency':return `${sign}$${v.toFixed(decimals)}`;
    case 'integer': return `${sign}${Math.round(v)}`;
    default:        return `${sign}${v.toFixed(decimals)}`;
  }
}

export default function NumericCell({
  value,
  format = 'number',
  decimals = 2,
  thresholds,
  forceColor,
  suffix,
  showSign,
  className = '',
}: Props) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <span className={className} style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        —
      </span>
    );
  }

  const t: Required<Thresholds> = {
    strongUp:   thresholds?.strongUp   ?? 1.0,
    strongDown: thresholds?.strongDown ?? 1.0,
    flat:       thresholds?.flat       ?? 0.05,
  };

  const tier = forceColor ?? classify(value, t);
  const sign = showSign ?? (format === 'pnl' || format === 'percent');
  const text = formatValue(value, format, decimals, sign);

  return (
    <span
      className={className}
      style={{
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        color: colorVarMap[tier],
        whiteSpace: 'nowrap',
      }}
    >
      {text}
      {suffix && <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>{suffix}</span>}
    </span>
  );
}
