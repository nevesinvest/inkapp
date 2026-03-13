import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "../api/client";
import { CurrencyInput } from "../components/CurrencyInput";
import { FeedbackMessage } from "../components/FeedbackMessage";
import { MetricCard } from "../components/MetricCard";
import { useAuth } from "../context/AuthContext";
import { formatCurrency, formatDateShort } from "../utils/format";
import { toDateInputSaoPaulo } from "../utils/timezone";

const PERIOD_OPTIONS = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "Ultimos 7 dias" },
  { value: "last30", label: "Ultimos 30 dias" },
  { value: "month", label: "Mes atual" },
  { value: "quarter", label: "Trimestre atual" },
  { value: "year", label: "Ano atual" },
  { value: "custom", label: "Personalizado" }
];

const CHART_COLORS = ["#111111", "#e06b2f", "#1f8d57", "#1565c0", "#9c6644", "#b93a3a", "#6a5acd"];

const ENTRY_TYPE_LABELS = {
  payable: "Conta a Pagar",
  receivable: "Conta a Receber"
};

function parseDateInput(value) {
  const normalized = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  const [year, month, day] = normalized.split("-").map((item) => Number(item));
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function resolveRangeByPeriod(period, referenceDateValue = toDateInputSaoPaulo()) {
  const referenceDate = parseDateInput(referenceDateValue) || new Date();
  const endDate = new Date(referenceDate);

  if (period === "today") {
    return {
      dateFrom: toDateInputValue(referenceDate),
      dateTo: toDateInputValue(referenceDate)
    };
  }

  if (period === "last7") {
    return {
      dateFrom: toDateInputValue(addDays(endDate, -6)),
      dateTo: toDateInputValue(endDate)
    };
  }

  if (period === "last30") {
    return {
      dateFrom: toDateInputValue(addDays(endDate, -29)),
      dateTo: toDateInputValue(endDate)
    };
  }

  if (period === "quarter") {
    const quarterStartMonth = Math.floor(endDate.getMonth() / 3) * 3;
    return {
      dateFrom: toDateInputValue(new Date(endDate.getFullYear(), quarterStartMonth, 1)),
      dateTo: toDateInputValue(new Date(endDate.getFullYear(), quarterStartMonth + 3, 0))
    };
  }

  if (period === "year") {
    return {
      dateFrom: toDateInputValue(new Date(endDate.getFullYear(), 0, 1)),
      dateTo: toDateInputValue(new Date(endDate.getFullYear(), 12, 0))
    };
  }

  return {
    dateFrom: toDateInputValue(new Date(endDate.getFullYear(), endDate.getMonth(), 1)),
    dateTo: toDateInputValue(new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0))
  };
}

function resolveComparisonRange(dateFrom, dateTo) {
  const start = parseDateInput(dateFrom);
  const end = parseDateInput(dateTo);
  if (!start || !end || start > end) return null;

  const durationInDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const comparisonEnd = addDays(start, -1);
  const comparisonStart = addDays(comparisonEnd, -(durationInDays - 1));

  return {
    dateFrom: toDateInputValue(comparisonStart),
    dateTo: toDateInputValue(comparisonEnd)
  };
}

function toPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function isDateWithinRange(dateValue, dateFrom, dateTo) {
  const normalized = String(dateValue || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  if (dateFrom && normalized < dateFrom) return false;
  if (dateTo && normalized > dateTo) return false;
  return true;
}

function safeChartLabel(value, maxLength = 22) {
  const text = String(value || "-").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function daysOverdue(dueDate, todayDate) {
  if (!dueDate || !todayDate) return 0;
  const due = parseDateInput(dueDate);
  const today = parseDateInput(todayDate);
  if (!due || !today || due >= today) return 0;
  const diffMs = today.getTime() - due.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function currencyTooltipFormatter(value) {
  return formatCurrency(Number(value || 0));
}

function buildEntriesSummary(rows, today) {
  const summary = {
    entryCount: rows.length,
    totalReceivable: 0,
    totalPayable: 0,
    receivablePending: 0,
    receivableLiquidated: 0,
    receivableCancelled: 0,
    payablePending: 0,
    payableLiquidated: 0,
    payableCancelled: 0,
    overdueReceivable: 0,
    overduePayable: 0
  };

  rows.forEach((row) => {
    const amount = Number(row.amount || 0);
    const isPending = row.settlement_status === "pending";
    const isLiquidated = row.settlement_status === "liquidated";
    const isCancelled = row.settlement_status === "cancelled";
    const isOverdue = isPending && row.due_date && row.due_date < today;

    if (row.entry_type === "receivable") {
      summary.totalReceivable += amount;
      if (isPending) summary.receivablePending += amount;
      if (isLiquidated) summary.receivableLiquidated += amount;
      if (isCancelled) summary.receivableCancelled += amount;
      if (isOverdue) summary.overdueReceivable += amount;
    } else {
      summary.totalPayable += amount;
      if (isPending) summary.payablePending += amount;
      if (isLiquidated) summary.payableLiquidated += amount;
      if (isCancelled) summary.payableCancelled += amount;
      if (isOverdue) summary.overduePayable += amount;
    }
  });

  const totalProjected = summary.totalReceivable + summary.totalPayable;
  const netProjected = summary.totalReceivable - summary.totalPayable;
  const netLiquidated = summary.receivableLiquidated - summary.payableLiquidated;
  const netPending = summary.receivablePending - summary.payablePending;
  const coveragePending =
    summary.payablePending > 0
      ? summary.receivablePending / summary.payablePending
      : summary.receivablePending > 0
        ? Number.POSITIVE_INFINITY
        : 0;

  return {
    ...summary,
    netProjected,
    netLiquidated,
    netPending,
    liquidationRate: totalProjected > 0
      ? ((summary.receivableLiquidated + summary.payableLiquidated) / totalProjected) * 100
      : 0,
    receivableDelinquencyRate: summary.receivablePending > 0
      ? (summary.overdueReceivable / summary.receivablePending) * 100
      : 0,
    marginProjected: summary.totalReceivable > 0
      ? (netProjected / summary.totalReceivable) * 100
      : 0,
    coveragePending
  };
}

function calculateVariation(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }

  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return null;

  if (previousValue === 0) {
    return currentValue === 0 ? 0 : null;
  }

  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

function resolveVariationTone(variation, higherIsBetter = true) {
  if (variation === null || variation === 0) return "neutral";
  if (higherIsBetter) return variation > 0 ? "positive" : "negative";
  return variation < 0 ? "positive" : "negative";
}

function formatVariation(variation) {
  if (variation === null) return "Sem base comparativa";
  const signal = variation > 0 ? "+" : "";
  return `${signal}${variation.toFixed(1)}% vs periodo anterior`;
}

function formatCoverage(value) {
  if (!Number.isFinite(Number(value))) return "Sem base";
  if (Number(value) >= 99) return "99.0x+";
  return `${Number(value).toFixed(2)}x`;
}

function resolveGaugePalette(mode = "target") {
  if (mode === "limit") {
    return {
      low: "#1f8d57",
      mid: "#c98300",
      high: "#b93a3a"
    };
  }

  return {
    low: "#b93a3a",
    mid: "#c98300",
    high: "#1f8d57"
  };
}

function resolveGaugeColorByValue(value, mode = "target") {
  const safeValue = Number(value || 0);
  const palette = resolveGaugePalette(mode);
  if (safeValue <= 70) return palette.low;
  if (safeValue <= 90) return palette.mid;
  return palette.high;
}

function pointOnArc(cx, cy, radius, angleDeg) {
  const rad = (Math.PI / 180) * angleDeg;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy - radius * Math.sin(rad)
  };
}

function buildArcPath(cx, cy, radius, startAngle, endAngle, step = 2) {
  const direction = startAngle >= endAngle ? -1 : 1;
  const points = [];

  let angle = startAngle;
  while (direction === -1 ? angle >= endAngle : angle <= endAngle) {
    points.push(pointOnArc(cx, cy, radius, angle));
    angle += direction * step;
  }

  const endPoint = pointOnArc(cx, cy, radius, endAngle);
  const last = points[points.length - 1];
  if (!last || Math.abs(last.x - endPoint.x) > 0.01 || Math.abs(last.y - endPoint.y) > 0.01) {
    points.push(endPoint);
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function buildNeedlePolygon(cx, cy, angle, length = 66, baseHalf = 4) {
  const tip = pointOnArc(cx, cy, length, angle);
  const rad = (Math.PI / 180) * angle;
  const perpX = Math.sin(rad);
  const perpY = Math.cos(rad);

  const baseLeft = {
    x: cx + perpX * baseHalf,
    y: cy + perpY * baseHalf
  };
  const baseRight = {
    x: cx - perpX * baseHalf,
    y: cy - perpY * baseHalf
  };

  return `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${baseLeft.x.toFixed(2)},${baseLeft.y.toFixed(2)} ${baseRight.x.toFixed(2)},${baseRight.y.toFixed(2)}`;
}

function SpeedometerGauge({ value, mode = "target" }) {
  const safeValue = clamp(Number(value || 0), 0, 100);
  const angle = 180 - safeValue * 1.8;
  const gaugeColor = resolveGaugeColorByValue(safeValue, mode);
  const gaugePalette = resolveGaugePalette(mode);
  const cx = 110;
  const cy = 106;
  const arcRadius = 84;
  const progressPath = safeValue > 0 ? buildArcPath(cx, cy, arcRadius, 180, angle) : "";

  const majorTicks = Array.from({ length: 11 }, (_, index) => index * 10);
  const minorTicks = Array.from({ length: 51 }, (_, index) => index * 2)
    .filter((tick) => tick % 10 !== 0);

  return (
    <div className="finance-bi-speedometer">
      <svg
        aria-label={`Velocimetro em ${safeValue.toFixed(0)}%`}
        className="finance-bi-speedometer-svg"
        role="img"
        viewBox="0 0 220 130"
      >
        <path d={buildArcPath(cx, cy, arcRadius, 180, 0)} fill="none" stroke="#e1e8f2" strokeWidth="16" />
        <path d={buildArcPath(cx, cy, arcRadius, 180, 54)} fill="none" stroke={gaugePalette.low} strokeWidth="14" strokeLinecap="round" opacity="0.34" />
        <path d={buildArcPath(cx, cy, arcRadius, 54, 18)} fill="none" stroke={gaugePalette.mid} strokeWidth="14" strokeLinecap="round" opacity="0.36" />
        <path d={buildArcPath(cx, cy, arcRadius, 18, 0)} fill="none" stroke={gaugePalette.high} strokeWidth="14" strokeLinecap="round" opacity="0.36" />

        {minorTicks.map((tick) => {
          const tickAngle = 180 - tick * 1.8;
          const inner = pointOnArc(cx, cy, 75, tickAngle);
          const outer = pointOnArc(cx, cy, 89, tickAngle);
          return (
            <line
              key={`minor-${tick}`}
              stroke="#7a889c"
              strokeOpacity="0.4"
              strokeWidth="1.2"
              x1={inner.x}
              x2={outer.x}
              y1={inner.y}
              y2={outer.y}
            />
          );
        })}

        {majorTicks.map((tick) => {
          const tickAngle = 180 - tick * 1.8;
          const inner = pointOnArc(cx, cy, 71, tickAngle);
          const outer = pointOnArc(cx, cy, 92, tickAngle);
          const labelPoint = pointOnArc(cx, cy, 62, tickAngle);

          return (
            <g key={`major-${tick}`}>
              <line
                stroke="#516276"
                strokeWidth="2"
                x1={inner.x}
                x2={outer.x}
                y1={inner.y}
                y2={outer.y}
              />
              <text
                className="finance-bi-speedometer-tick-label"
                textAnchor="middle"
                x={labelPoint.x}
                y={labelPoint.y + 4}
              >
                {tick}
              </text>
            </g>
          );
        })}

        {progressPath ? (
          <path
            d={progressPath}
            fill="none"
            stroke={gaugeColor}
            strokeLinecap="round"
            strokeWidth="9"
          />
        ) : null}

        <polygon fill="#111111" points={buildNeedlePolygon(cx, cy, angle)} />
        <circle cx={cx} cy={cy} fill="#f8fbff" r="8.5" stroke="#0f172a" strokeWidth="3" />
        <circle cx={cx} cy={cy} fill="#0f172a" r="3.2" />

        <text className="finance-bi-speedometer-value" textAnchor="middle" x={cx} y={88}>
          {safeValue.toFixed(0)}%
        </text>
        <text className="finance-bi-speedometer-caption" textAnchor="middle" x={cx} y={100}>
          atingimento
        </text>
      </svg>
    </div>
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatMetaMetric(value, metricFormat) {
  if (metricFormat === "currency") return formatCurrency(Number(value || 0));
  if (metricFormat === "percent") return toPercent(Number(value || 0));
  if (metricFormat === "ratio") return formatCoverage(value);
  return String(value ?? "-");
}

function formatMetaGapValue(value, metricFormat) {
  const absolute = Math.abs(Number(value || 0));
  if (metricFormat === "currency") return formatCurrency(absolute);
  if (metricFormat === "percent") return `${absolute.toFixed(1)} p.p.`;
  if (metricFormat === "ratio") return `${absolute.toFixed(2)}x`;
  return absolute.toFixed(2);
}

function buildAutomaticDirectorTargets(totals, comparisonTotals) {
  const previousRevenue = Math.max(Number(comparisonTotals.totalReceivable || 0), 0);
  const previousExpense = Math.max(Number(comparisonTotals.totalPayable || 0), 0);
  const previousMargin = clamp(Number(comparisonTotals.marginProjected || 0), 0, 100);
  const previousLiquidation = clamp(Number(comparisonTotals.liquidationRate || 0), 0, 100);
  const previousDelinquency = clamp(Number(comparisonTotals.receivableDelinquencyRate || 0), 0, 100);
  const previousCashFlow = Number(comparisonTotals.netProjected || 0);
  const currentCashFlow = Number(totals.netProjected || 0);

  return {
    revenueTarget: previousRevenue > 0 ? previousRevenue * 1.1 : Math.max(Number(totals.totalReceivable || 0), 0),
    expenseLimit: previousExpense > 0 ? previousExpense * 0.97 : Math.max(Number(totals.totalPayable || 0), 0),
    projectedMarginTarget: previousMargin > 0 ? clamp(previousMargin + 2, 12, 75) : 25,
    liquidationRateTarget: previousLiquidation > 0 ? clamp(previousLiquidation + 3, 65, 98) : 78,
    receivableDelinquencyLimit: previousDelinquency > 0 ? clamp(previousDelinquency - 1, 3, 18) : 8,
    pendingCoverageTarget: previousCashFlow > 0 ? previousCashFlow * 1.05 : Math.max(currentCashFlow, 0)
  };
}

function toDirectorTargetFormValues(target, fallbackTargets) {
  if (target) {
    return {
      revenueTarget: Number(target.revenue_target || 0),
      expenseLimit: Number(target.expense_limit || 0),
      projectedMarginTarget: Number(target.projected_margin_target || 0),
      liquidationRateTarget: Number(target.liquidation_rate_target || 0),
      receivableDelinquencyLimit: Number(target.receivable_delinquency_limit || 0),
      pendingCoverageTarget: Number(target.pending_coverage_target || 0),
      notes: String(target.notes || "")
    };
  }

  return {
    revenueTarget: roundMoney(fallbackTargets.revenueTarget),
    expenseLimit: roundMoney(fallbackTargets.expenseLimit),
    projectedMarginTarget: roundMoney(fallbackTargets.projectedMarginTarget),
    liquidationRateTarget: roundMoney(fallbackTargets.liquidationRateTarget),
    receivableDelinquencyLimit: roundMoney(fallbackTargets.receivableDelinquencyLimit),
    pendingCoverageTarget: roundMoney(fallbackTargets.pendingCoverageTarget),
    notes: ""
  };
}

function evaluateMetaPerformance({ actual, target, metricFormat, higherIsBetter }) {
  const actualValue = Number(actual);
  const targetValue = Number(target);

  if (!Number.isFinite(actualValue) || !Number.isFinite(targetValue) || targetValue < 0) {
    return {
      status: "neutral",
      statusLabel: "Sem parametro",
      progressPercent: 0,
      attainmentLabel: "Meta indisponivel",
      gapLabel: "Sem base comparativa"
    };
  }

  if (targetValue === 0) {
    if (actualValue === 0) {
      return {
        status: "positive",
        statusLabel: "No alvo",
        progressPercent: 100,
        attainmentLabel: "100.0% da meta",
        gapLabel: "Dentro da meta"
      };
    }
    return {
      status: "neutral",
      statusLabel: "Sem parametro",
      progressPercent: 0,
      attainmentLabel: "Meta indisponivel",
      gapLabel: "Sem base comparativa"
    };
  }

  const attainment = higherIsBetter
    ? (actualValue / targetValue) * 100
    : (targetValue / Math.max(actualValue, 0.0001)) * 100;

  let status = "negative";
  if (higherIsBetter) {
    if (actualValue >= targetValue) status = "positive";
    else if (actualValue >= targetValue * 0.85) status = "warning";
  } else {
    if (actualValue <= targetValue) status = "positive";
    else if (actualValue <= targetValue * 1.2) status = "warning";
  }

  const deltaToTarget = higherIsBetter ? actualValue - targetValue : targetValue - actualValue;
  const relationText = higherIsBetter
    ? (deltaToTarget >= 0 ? "acima da meta" : "abaixo da meta")
    : (deltaToTarget >= 0 ? "melhor que limite" : "acima do limite");

  return {
    status,
    statusLabel: status === "positive" ? "No alvo" : status === "warning" ? "Atencao" : "Critico",
    progressPercent: clamp(attainment, 0, 100),
    attainmentLabel: `${attainment.toFixed(1)}% da meta`,
    gapLabel: `${formatMetaGapValue(deltaToTarget, metricFormat)} ${relationText}`
  };
}

function evaluateExpenseLimitPerformance({ actual, target, metricFormat }) {
  const actualValue = Number(actual);
  const targetValue = Number(target);

  if (!Number.isFinite(actualValue) || !Number.isFinite(targetValue) || targetValue <= 0) {
    return {
      status: "neutral",
      statusLabel: "Sem parametro",
      progressPercent: 0,
      attainmentLabel: "Limite indisponivel",
      gapLabel: "Sem base comparativa"
    };
  }

  const utilization = (actualValue / targetValue) * 100;
  let status = "negative";
  if (utilization <= 70) status = "positive";
  else if (utilization <= 90) status = "warning";

  const deltaToLimit = targetValue - actualValue;
  const relationText = deltaToLimit > 0 ? "abaixo do limite" : deltaToLimit < 0 ? "acima do limite" : "no limite";
  const gapLabel = deltaToLimit === 0
    ? "No limite"
    : `${formatMetaGapValue(deltaToLimit, metricFormat)} ${relationText}`;

  return {
    status,
    statusLabel: status === "positive" ? "No alvo" : status === "warning" ? "Atencao" : "Critico",
    progressPercent: clamp(utilization, 0, 100),
    attainmentLabel: `${utilization.toFixed(1)}% do limite`,
    gapLabel
  };
}

function evaluateCashFlowPerformance({ actual, target }) {
  const actualValue = Number(actual);
  const targetValue = Number(target);

  if (!Number.isFinite(actualValue) || !Number.isFinite(targetValue) || targetValue < 0) {
    return {
      status: "neutral",
      statusLabel: "Sem parametro",
      progressPercent: 0,
      attainmentLabel: "Indicador indisponivel",
      gapLabel: "Sem base comparativa"
    };
  }

  const progress = targetValue > 0
    ? (actualValue / targetValue) * 100
    : actualValue >= 0
      ? 100
      : 0;
  let status = "negative";
  if (targetValue === 0) {
    status = actualValue >= 0 ? "positive" : "negative";
  } else if (actualValue >= targetValue) {
    status = "positive";
  } else if (actualValue >= targetValue * 0.7) {
    status = "warning";
  }

  const deltaToDesired = actualValue - targetValue;
  let gapLabel = "";
  if (targetValue === 0) {
    gapLabel = actualValue >= 0
      ? `${formatCurrency(actualValue)} de sobra de caixa`
      : `${formatCurrency(Math.abs(actualValue))} de falta de caixa`;
  } else if (deltaToDesired >= 0) {
    gapLabel = `${formatCurrency(deltaToDesired)} acima da sobra desejada`;
  } else {
    gapLabel = `${formatCurrency(Math.abs(deltaToDesired))} abaixo da sobra desejada`;
  }

  return {
    status,
    statusLabel: actualValue >= 0 ? "Sobra de caixa" : "Falta de caixa",
    progressPercent: clamp(progress, 0, 100),
    attainmentLabel: targetValue > 0
      ? `${progress.toFixed(1)}% da sobra desejada`
      : actualValue >= 0
        ? "Sobra de caixa"
        : "Falta de caixa",
    gapLabel
  };
}

export function FinancialSummaryPage() {
  const { token } = useAuth();
  const [filters, setFilters] = useState(() => {
    const initialRange = resolveRangeByPeriod("month");
    return {
      period: "month",
      dateFrom: initialRange.dateFrom,
      dateTo: initialRange.dateTo
    };
  });
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState([]);
  const [comparisonEntries, setComparisonEntries] = useState([]);
  const [dueEntries, setDueEntries] = useState([]);
  const [liquidationTimelineRows, setLiquidationTimelineRows] = useState([]);
  const [comparisonRange, setComparisonRange] = useState(null);
  const [receivableByClient, setReceivableByClient] = useState([]);
  const [artistEarnings, setArtistEarnings] = useState([]);
  const [accountsOverview, setAccountsOverview] = useState(null);
  const [directorTarget, setDirectorTarget] = useState(null);
  const [targetForm, setTargetForm] = useState({
    revenueTarget: 0,
    expenseLimit: 0,
    projectedMarginTarget: 25,
    liquidationRateTarget: 78,
    receivableDelinquencyLimit: 8,
    pendingCoverageTarget: 0,
    notes: ""
  });
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetFeedback, setTargetFeedback] = useState("");
  const [error, setError] = useState("");

  async function loadDashboard(nextFilters = filters) {
    if (!token) return;

    if (!nextFilters.dateFrom || !nextFilters.dateTo) {
      setError("Informe o periodo para gerar o dashboard.");
      return;
    }
    if (nextFilters.dateFrom > nextFilters.dateTo) {
      setError("Data inicial nao pode ser maior que a data final.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const nextComparisonRange = resolveComparisonRange(nextFilters.dateFrom, nextFilters.dateTo);
      const entriesParams = new URLSearchParams({
        issueDateFrom: nextFilters.dateFrom,
        issueDateTo: nextFilters.dateTo,
        periodMode: "issue_or_liquidated",
        limit: "3000"
      });
      const comparisonParams = new URLSearchParams({
        issueDateFrom: nextComparisonRange?.dateFrom || "",
        issueDateTo: nextComparisonRange?.dateTo || "",
        periodMode: "issue_or_liquidated",
        limit: "3000"
      });
      const dueEntriesParams = new URLSearchParams({
        dueDateFrom: nextFilters.dateFrom,
        dueDateTo: nextFilters.dateTo,
        limit: "3000"
      });
      const liquidationTimelineParams = new URLSearchParams({
        dateFrom: nextFilters.dateFrom,
        dateTo: nextFilters.dateTo
      });
      const sliceParams = new URLSearchParams({
        dateFrom: nextFilters.dateFrom,
        dateTo: nextFilters.dateTo
      });
      const earningsParams = new URLSearchParams({
        from: nextFilters.dateFrom,
        to: nextFilters.dateTo
      });
      const directorTargetParams = new URLSearchParams({
        dateFrom: nextFilters.dateFrom,
        dateTo: nextFilters.dateTo
      });

      const [
        entriesData,
        comparisonEntriesData,
        dueEntriesData,
        liquidationTimelineResponse,
        receivableData,
        earningsData,
        overviewData,
        directorTargetData
      ] = await Promise.all([
        api.request(`/finance/entries?${entriesParams.toString()}`, { token }),
        nextComparisonRange
          ? api.request(`/finance/entries?${comparisonParams.toString()}`, { token })
          : Promise.resolve([]),
        api.request(`/finance/entries?${dueEntriesParams.toString()}`, { token }),
        api.request(`/finance/liquidation-timeline?${liquidationTimelineParams.toString()}`, { token }),
        api.request(`/finance/accounts-receivable/by-client?${sliceParams.toString()}`, { token }),
        api.request(`/finance/artist-earnings?${earningsParams.toString()}`, { token }),
        api.request("/finance/accounts-overview", { token }),
        api.request(`/finance/director-target?${directorTargetParams.toString()}`, { token })
      ]);

      const nextEntries = Array.isArray(entriesData) ? entriesData : [];
      const nextComparisonEntries = Array.isArray(comparisonEntriesData) ? comparisonEntriesData : [];
      const nextDueEntries = Array.isArray(dueEntriesData) ? dueEntriesData : [];
      const nextLiquidationTimeline = Array.isArray(liquidationTimelineResponse?.rows)
        ? liquidationTimelineResponse.rows
        : [];
      const targetPayload = directorTargetData?.target || null;
      const autoTargets = buildAutomaticDirectorTargets(
        buildEntriesSummary(nextEntries, toDateInputSaoPaulo()),
        buildEntriesSummary(nextComparisonEntries, toDateInputSaoPaulo())
      );

      setEntries(nextEntries);
      setComparisonEntries(nextComparisonEntries);
      setDueEntries(nextDueEntries);
      setLiquidationTimelineRows(nextLiquidationTimeline);
      setComparisonRange(nextComparisonRange);
      setReceivableByClient(Array.isArray(receivableData?.rows) ? receivableData.rows : []);
      setArtistEarnings(Array.isArray(earningsData?.earnings) ? earningsData.earnings : []);
      setAccountsOverview(overviewData || null);
      setDirectorTarget(targetPayload);
      setTargetForm(toDirectorTargetFormValues(targetPayload, autoTargets));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    void loadDashboard(filters);
  }, [token]);

  function handlePeriodChange(nextPeriod) {
    setTargetFeedback("");
    if (nextPeriod === "custom") {
      setFilters((current) => ({ ...current, period: "custom" }));
      return;
    }

    const range = resolveRangeByPeriod(nextPeriod);
    const nextFilters = {
      period: nextPeriod,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo
    };
    setFilters(nextFilters);
    void loadDashboard(nextFilters);
  }

  function handleDateChange(field, value) {
    setTargetFeedback("");
    setFilters((current) => ({
      ...current,
      period: "custom",
      [field]: value
    }));
  }

  async function handleApplyFilters(event) {
    event.preventDefault();
    await loadDashboard(filters);
  }

  async function handleResetFilters() {
    setTargetFeedback("");
    const range = resolveRangeByPeriod("month");
    const nextFilters = {
      period: "month",
      dateFrom: range.dateFrom,
      dateTo: range.dateTo
    };
    setFilters(nextFilters);
    await loadDashboard(nextFilters);
  }

  function handleTargetFieldChange(field, value) {
    setTargetForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSaveDirectorTarget(event) {
    event.preventDefault();
    if (!filters.dateFrom || !filters.dateTo) {
      setError("Informe o periodo antes de salvar metas.");
      return;
    }
    if (filters.dateFrom > filters.dateTo) {
      setError("Data inicial nao pode ser maior que a data final.");
      return;
    }

    const payload = {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      revenueTarget: Number(targetForm.revenueTarget || 0),
      expenseLimit: Number(targetForm.expenseLimit || 0),
      projectedMarginTarget: Number(targetForm.projectedMarginTarget || 0),
      liquidationRateTarget: Number(targetForm.liquidationRateTarget || 0),
      receivableDelinquencyLimit: Number(targetForm.receivableDelinquencyLimit || 0),
      pendingCoverageTarget: Number(targetForm.pendingCoverageTarget || 0),
      notes: String(targetForm.notes || "").trim()
    };

    if (
      payload.revenueTarget < 0 ||
      payload.expenseLimit < 0 ||
      payload.pendingCoverageTarget < 0
    ) {
      setError("Metas monetarias e sobra de caixa desejada nao podem ser negativas.");
      return;
    }

    if (
      payload.projectedMarginTarget < 0 ||
      payload.projectedMarginTarget > 100 ||
      payload.liquidationRateTarget < 0 ||
      payload.liquidationRateTarget > 100 ||
      payload.receivableDelinquencyLimit < 0 ||
      payload.receivableDelinquencyLimit > 100
    ) {
      setError("Margem, liquidacao e inadimplencia devem ficar entre 0 e 100.");
      return;
    }

    setSavingTarget(true);
    setError("");
    setTargetFeedback("");
    try {
      const response = await api.request("/finance/director-target", {
        method: "PUT",
        token,
        body: payload
      });
      const savedTarget = response?.target || null;
      setDirectorTarget(savedTarget);
      if (savedTarget) {
        const autoTargets = buildAutomaticDirectorTargets(totals, comparisonTotals);
        setTargetForm(toDirectorTargetFormValues(savedTarget, autoTargets));
      }
      setTargetFeedback("Metas da diretoria salvas para o periodo.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingTarget(false);
    }
  }

  const today = toDateInputSaoPaulo();

  const totals = useMemo(() => buildEntriesSummary(entries, today), [entries, today]);
  const comparisonTotals = useMemo(() => buildEntriesSummary(comparisonEntries, today), [comparisonEntries, today]);

  const selectedRangeLabel = useMemo(() => {
    if (!filters.dateFrom || !filters.dateTo) return "-";
    return `${formatDateShort(filters.dateFrom)} ate ${formatDateShort(filters.dateTo)}`;
  }, [filters.dateFrom, filters.dateTo]);

  const comparisonRangeLabel = useMemo(() => {
    if (!comparisonRange?.dateFrom || !comparisonRange?.dateTo) return "-";
    return `${formatDateShort(comparisonRange.dateFrom)} ate ${formatDateShort(comparisonRange.dateTo)}`;
  }, [comparisonRange]);

  const executiveSignals = useMemo(
    () => [
      { label: "Periodo analisado", value: selectedRangeLabel },
      { label: "Comparativo anterior", value: comparisonRangeLabel },
      { label: "Resultado projetado", value: formatCurrency(totals.netProjected) },
      { label: "Resultado realizado", value: formatCurrency(totals.netLiquidated) }
    ],
    [selectedRangeLabel, comparisonRangeLabel, totals.netProjected, totals.netLiquidated]
  );

  const directorHighlights = useMemo(
    () => [
      {
        key: "revenue",
        label: "Receita bruta",
        value: formatCurrency(totals.totalReceivable),
        secondary: `Anterior: ${formatCurrency(comparisonTotals.totalReceivable)}`,
        variation: calculateVariation(totals.totalReceivable, comparisonTotals.totalReceivable),
        higherIsBetter: true
      },
      {
        key: "expense",
        label: "Despesa total",
        value: formatCurrency(totals.totalPayable),
        secondary: `Anterior: ${formatCurrency(comparisonTotals.totalPayable)}`,
        variation: calculateVariation(totals.totalPayable, comparisonTotals.totalPayable),
        higherIsBetter: false
      },
      {
        key: "projected",
        label: "Resultado projetado",
        value: formatCurrency(totals.netProjected),
        secondary: `Anterior: ${formatCurrency(comparisonTotals.netProjected)}`,
        variation: calculateVariation(totals.netProjected, comparisonTotals.netProjected),
        higherIsBetter: true
      },
      {
        key: "realized",
        label: "Resultado realizado",
        value: formatCurrency(totals.netLiquidated),
        secondary: `Anterior: ${formatCurrency(comparisonTotals.netLiquidated)}`,
        variation: calculateVariation(totals.netLiquidated, comparisonTotals.netLiquidated),
        higherIsBetter: true
      },
      {
        key: "margin",
        label: "Margem projetada",
        value: toPercent(totals.marginProjected),
        secondary: `Anterior: ${toPercent(comparisonTotals.marginProjected)}`,
        variation: calculateVariation(totals.marginProjected, comparisonTotals.marginProjected),
        higherIsBetter: true
      },
      {
        key: "delinquency",
        label: "Inadimplencia",
        value: toPercent(totals.receivableDelinquencyRate),
        secondary: `Anterior: ${toPercent(comparisonTotals.receivableDelinquencyRate)}`,
        variation: calculateVariation(totals.receivableDelinquencyRate, comparisonTotals.receivableDelinquencyRate),
        higherIsBetter: false
      },
      {
        key: "pending-net",
        label: "Fluxo de caixa",
        value: formatCurrency(totals.netProjected),
        secondary: `Anterior: ${formatCurrency(comparisonTotals.netProjected)}`,
        variation: calculateVariation(totals.netProjected, comparisonTotals.netProjected),
        higherIsBetter: true
      }
    ],
    [totals, comparisonTotals]
  );

  const automaticDirectorTargets = useMemo(
    () => buildAutomaticDirectorTargets(totals, comparisonTotals),
    [totals, comparisonTotals]
  );

  const effectiveDirectorTargets = useMemo(
    () => (directorTarget
      ? {
          revenueTarget: Number(directorTarget.revenue_target || 0),
          expenseLimit: Number(directorTarget.expense_limit || 0),
          projectedMarginTarget: Number(directorTarget.projected_margin_target || 0),
          liquidationRateTarget: Number(directorTarget.liquidation_rate_target || 0),
          receivableDelinquencyLimit: Number(directorTarget.receivable_delinquency_limit || 0),
          pendingCoverageTarget: Number(directorTarget.pending_coverage_target || 0)
        }
      : automaticDirectorTargets),
    [directorTarget, automaticDirectorTargets]
  );

  const directorTargetCards = useMemo(() => {
    const rows = [
      {
        key: "target-revenue",
        label: "Receita bruta",
        actual: totals.totalReceivable,
        target: effectiveDirectorTargets.revenueTarget,
        metricFormat: "currency",
        higherIsBetter: true
      },
      {
        key: "target-expense",
        label: "Despesa total",
        actual: totals.totalPayable,
        target: effectiveDirectorTargets.expenseLimit,
        metricFormat: "currency",
        higherIsBetter: false,
        gaugeMode: "limit",
        targetLabelPrefix: "Limite",
        evaluationMode: "limit"
      },
      {
        key: "target-margin",
        label: "Margem projetada",
        actual: totals.marginProjected,
        target: effectiveDirectorTargets.projectedMarginTarget,
        metricFormat: "percent",
        higherIsBetter: true
      },
      {
        key: "target-liquidation",
        label: "Taxa de liquidacao",
        actual: totals.liquidationRate,
        target: effectiveDirectorTargets.liquidationRateTarget,
        metricFormat: "percent",
        higherIsBetter: true
      },
      {
        key: "target-delinquency",
        label: "Inadimplencia",
        actual: totals.receivableDelinquencyRate,
        target: effectiveDirectorTargets.receivableDelinquencyLimit,
        metricFormat: "percent",
        higherIsBetter: false
      },
      {
        key: "target-pending-balance",
        label: "Fluxo de caixa",
        actual: totals.netProjected,
        target: effectiveDirectorTargets.pendingCoverageTarget,
        metricFormat: "currency",
        higherIsBetter: true,
        targetLabelPrefix: "Sobra desejada",
        evaluationMode: "cashflow"
      }
    ];

    return rows.map((row) => {
      const performance = row.evaluationMode === "limit"
        ? evaluateExpenseLimitPerformance(row)
        : row.evaluationMode === "cashflow"
          ? evaluateCashFlowPerformance(row)
        : evaluateMetaPerformance(row);
      return {
        ...row,
        ...performance,
        actualLabel: formatMetaMetric(row.actual, row.metricFormat),
        targetLabel: formatMetaMetric(row.target, row.metricFormat),
        targetLabelPrefix: row.targetLabelPrefix || "Meta",
        gaugeMode: row.gaugeMode || "target"
      };
    });
  }, [totals, effectiveDirectorTargets]);

  const targetModeLabel = directorTarget
    ? "Metas cadastradas para o periodo atual."
    : "Sem metas cadastradas. Comparativo usando metas automaticas.";

  const timelineChartData = useMemo(() => {
    const grouped = new Map();
    const filterStart = filters.dateFrom || null;
    const filterEnd = filters.dateTo || null;

    dueEntries.forEach((row) => {
      const key = String(row.due_date || "").slice(0, 10);
      if (!key) return;
      if (filterStart && key < filterStart) return;
      if (filterEnd && key > filterEnd) return;

      const amount = Number(row.amount || 0);
      const current = grouped.get(key) || {
        date: key,
        receivable: 0,
        payable: 0,
        net: 0
      };

      if (row.entry_type === "receivable") {
        current.receivable += amount;
      } else {
        current.payable += amount;
      }
      current.net = current.receivable - current.payable;
      grouped.set(key, current);
    });

    return Array.from(grouped.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-90);
  }, [dueEntries, filters.dateFrom, filters.dateTo]);

  const liquidationTimelineData = useMemo(() => {
    return liquidationTimelineRows
      .map((row) => ({
        date: String(row.date || "").slice(0, 10),
        income: Number(row.income || 0),
        expense: Number(row.expense || 0)
      }))
      .filter((row) => row.date && isDateWithinRange(row.date, filters.dateFrom, filters.dateTo))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [liquidationTimelineRows, filters.dateFrom, filters.dateTo]);

  const payableByExpenseTypePieData = useMemo(() => {
    const grouped = new Map();

    entries.forEach((row) => {
      if (row.entry_type !== "payable") return;
      if (row.settlement_status !== "liquidated") return;
      if (!isDateWithinRange(row.liquidated_on, filters.dateFrom, filters.dateTo)) return;

      const typeName = safeChartLabel(row.expense_type_name || "Sem tipo", 22);
      grouped.set(typeName, Number(grouped.get(typeName) || 0) + Number(row.amount || 0));
    });

    const rows = Array.from(grouped.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
    return rows.map((row) => ({
      ...row,
      sharePercent: totalValue > 0 ? (row.value / totalValue) * 100 : 0
    }));
  }, [entries, filters.dateFrom, filters.dateTo]);

  const receivableByClientPieData = useMemo(() => {
    const rows = receivableByClient
      .map((row) => {
        const value = Number(row.pending_total || 0) + Number(row.received_total || 0);
        return {
          baseName: safeChartLabel(row.client_name, 22),
          value
        };
      })
      .filter((row) => row.value > 0)
      .slice(0, 8);

    const totalRevenue = rows.reduce((sum, row) => sum + row.value, 0);
    return rows.map((row) => {
      const sharePercent = totalRevenue > 0 ? (row.value / totalRevenue) * 100 : 0;
      return {
        name: `${row.baseName} (${sharePercent.toFixed(1)}%)`,
        value: row.value,
        sharePercent
      };
    });
  }, [receivableByClient]);

  const artistEarningsPieData = useMemo(
    () =>
      artistEarnings
        .map((row) => ({
          name: row.artist_name,
          value: Number(row.total || 0)
        }))
        .filter((row) => row.value > 0),
    [artistEarnings]
  );

  const pendingEntries = useMemo(
    () =>
      entries
        .filter((row) => row.settlement_status === "pending")
        .sort((a, b) => {
          const dueA = String(a.due_date || "9999-12-31");
          const dueB = String(b.due_date || "9999-12-31");
          if (dueA !== dueB) return dueA.localeCompare(dueB);
          return Number(b.amount || 0) - Number(a.amount || 0);
        })
        .slice(0, 14),
    [entries]
  );

  return (
    <section className="section finance-bi-section">
      <div className="container finance-bi-container">
        <header className="finance-bi-hero">
          <div className="finance-bi-heading">
            <p className="finance-bi-kicker">Painel Diretoria</p>
            <h1>Painel Diretoria Financeiro</h1>
            <p>Indicadores estrategicos para diretoria com comparativo automatico frente ao periodo anterior.</p>
          </div>
          <div className="finance-bi-signals">
            {executiveSignals.map((signal) => (
              <article className="finance-bi-signal-card" key={signal.label}>
                <span>{signal.label}</span>
                <strong>{signal.value}</strong>
              </article>
            ))}
          </div>
        </header>

        <form className="form finance-bi-filters" onSubmit={handleApplyFilters}>
          <div className="finance-bi-filters-header">
            <h2>Periodo de analise</h2>
            <p>Selecione uma janela predefinida ou monte um recorte personalizado.</p>
            <p className="finance-bi-comparison-note">Comparativo anterior: {comparisonRangeLabel}</p>
          </div>
          <div className="grid-3 finance-bi-filter-grid">
            <label>
              Periodo
              <select value={filters.period} onChange={(event) => handlePeriodChange(event.target.value)}>
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Data inicial
              <input
                max={filters.dateTo || undefined}
                onChange={(event) => handleDateChange("dateFrom", event.target.value)}
                type="date"
                value={filters.dateFrom}
              />
            </label>
            <label>
              Data final
              <input
                min={filters.dateFrom || undefined}
                onChange={(event) => handleDateChange("dateTo", event.target.value)}
                type="date"
                value={filters.dateTo}
              />
            </label>
          </div>

          <div className="table-actions finance-bi-filter-actions">
            <button className="button button-primary" type="submit">
              Atualizar dashboard
            </button>
            <button className="button button-outline" onClick={handleResetFilters} type="button">
              Restaurar mes atual
            </button>
          </div>
        </form>

        {loading ? <p className="finance-bi-loading">Carregando dashboard financeiro...</p> : null}
        <FeedbackMessage message={error} type="error" />
        <FeedbackMessage message={targetFeedback} type="success" />

        <section className="finance-bi-block">
          <header className="finance-bi-block-header">
            <h2>Painel Diretoria</h2>
            <span>Metricas comparativas para tomada de decisao executiva</span>
          </header>
          <div className="finance-bi-director-grid">
            {directorHighlights.map((item) => {
              const tone = resolveVariationTone(item.variation, item.higherIsBetter);
              return (
                <article className={`finance-bi-director-card finance-bi-director-card-${tone}`} key={item.key}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.secondary}</small>
                  <em>{formatVariation(item.variation)}</em>
                </article>
              );
            })}
          </div>
        </section>

        <section className="finance-bi-block">
          <header className="finance-bi-block-header">
            <h2>Meta x Realizado</h2>
            <span>Monitoramento por faixas de alerta para diretoria</span>
          </header>
          <form className="form finance-bi-target-form" onSubmit={handleSaveDirectorTarget}>
            <div className="finance-bi-target-form-header">
              <h3>Cadastro de metas do periodo</h3>
              <span>{targetModeLabel}</span>
            </div>
            <div className="grid-3 finance-bi-target-form-grid">
              <label>
                Meta de receita
                <CurrencyInput
                  min={0}
                  onValueChange={(value) => handleTargetFieldChange("revenueTarget", value)}
                  value={targetForm.revenueTarget}
                />
              </label>
              <label>
                Limite de despesa
                <CurrencyInput
                  min={0}
                  onValueChange={(value) => handleTargetFieldChange("expenseLimit", value)}
                  value={targetForm.expenseLimit}
                />
              </label>
              <label>
                Meta de margem (%)
                <input
                  max={100}
                  min={0}
                  onChange={(event) => handleTargetFieldChange("projectedMarginTarget", event.target.value)}
                  step="0.1"
                  type="number"
                  value={targetForm.projectedMarginTarget}
                />
              </label>
              <label>
                Meta de liquidacao (%)
                <input
                  max={100}
                  min={0}
                  onChange={(event) => handleTargetFieldChange("liquidationRateTarget", event.target.value)}
                  step="0.1"
                  type="number"
                  value={targetForm.liquidationRateTarget}
                />
              </label>
              <label>
                Limite inadimplencia (%)
                <input
                  max={100}
                  min={0}
                  onChange={(event) => handleTargetFieldChange("receivableDelinquencyLimit", event.target.value)}
                  step="0.1"
                  type="number"
                  value={targetForm.receivableDelinquencyLimit}
                />
              </label>
              <label>
                Sobra de caixa desejada
                <CurrencyInput
                  min={0}
                  onValueChange={(value) => handleTargetFieldChange("pendingCoverageTarget", value)}
                  value={targetForm.pendingCoverageTarget}
                />
              </label>
            </div>
            <label>
              Observacoes da meta
              <textarea
                onChange={(event) => handleTargetFieldChange("notes", event.target.value)}
                rows={2}
                value={targetForm.notes}
              />
            </label>
            <div className="table-actions finance-bi-target-form-actions">
              <button className="button button-primary" disabled={savingTarget} type="submit">
                {savingTarget ? "Salvando metas..." : "Salvar metas do periodo"}
              </button>
            </div>
          </form>
          <div className="finance-bi-target-legend">
            <span className="finance-bi-target-pill finance-bi-target-pill-positive">No alvo</span>
            <span className="finance-bi-target-pill finance-bi-target-pill-warning">Atencao</span>
            <span className="finance-bi-target-pill finance-bi-target-pill-negative">Critico</span>
          </div>
          <div className="finance-bi-target-grid">
            {directorTargetCards.map((item) => {
              const gaugeValue = clamp(Number(item.progressPercent || 0), 0, 100);

              return (
                <article className={`finance-bi-target-card finance-bi-target-card-${item.status}`} key={item.key}>
                  <div className="finance-bi-target-head">
                    <span>{item.label}</span>
                    <strong>{item.actualLabel}</strong>
                  </div>
                  <div className="finance-bi-target-meta">
                    <small>{item.targetLabelPrefix}: {item.targetLabel}</small>
                    <small>{item.gapLabel}</small>
                  </div>
                  <SpeedometerGauge mode={item.gaugeMode} value={gaugeValue} />
                  <div className="finance-bi-target-footer">
                    <em>{item.statusLabel}</em>
                    <small>{item.attainmentLabel}</small>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="finance-bi-block">
          <header className="finance-bi-block-header">
            <h2>Indicadores operacionais</h2>
            <span>Apoio tatico para leitura da operacao financeira</span>
          </header>
          <div className="metrics-grid finance-bi-metrics">
            <MetricCard
              label="Total a receber (periodo)"
              value={formatCurrency(totals.totalReceivable)}
              hint={`Periodo: ${selectedRangeLabel}`}
            />
            <MetricCard label="Total a pagar (periodo)" value={formatCurrency(totals.totalPayable)} />
            <MetricCard label="Resultado projetado" value={formatCurrency(totals.netProjected)} />
            <MetricCard label="Recebido (liquidado)" value={formatCurrency(totals.receivableLiquidated)} />
            <MetricCard label="Pago (liquidado)" value={formatCurrency(totals.payableLiquidated)} />
            <MetricCard label="Resultado realizado" value={formatCurrency(totals.netLiquidated)} />
            <MetricCard label="A receber pendente" value={formatCurrency(totals.receivablePending)} />
            <MetricCard label="A pagar pendente" value={formatCurrency(totals.payablePending)} />
            <MetricCard label="Fluxo de caixa" value={formatCurrency(totals.netProjected)} />
            <MetricCard label="Taxa de liquidacao" value={toPercent(totals.liquidationRate)} />
            <MetricCard label="Lancamentos no periodo" value={String(totals.entryCount)} />
            <MetricCard label="Receber atrasado" value={formatCurrency(totals.overdueReceivable)} />
            <MetricCard label="Pagar atrasado" value={formatCurrency(totals.overduePayable)} />
            <MetricCard label="Margem projetada" value={toPercent(totals.marginProjected)} />
            <MetricCard label="Inadimplencia receber" value={toPercent(totals.receivableDelinquencyRate)} />
          </div>
        </section>

        {accountsOverview ? (
          <div className="service-summary finance-bi-overview-strip">
            <span>Carteira geral atual</span>
            <span>Receber pendente: {formatCurrency(accountsOverview?.receivable?.pendingTotal || 0)}</span>
            <span>Pagar pendente: {formatCurrency(accountsOverview?.payable?.pendingTotal || 0)}</span>
            <span>Fluxo de caixa atual: {formatCurrency(accountsOverview?.netPending || 0)}</span>
          </div>
        ) : null}

        <div className="chart-grid finance-bi-chart-grid">
          <article className="panel finance-bi-panel">
            <h2>Evolucao no periodo</h2>
            <div className="chart-box finance-bi-chart-box">
              {timelineChartData.length === 0 ? <p className="muted">Sem dados para o periodo.</p> : null}
              {timelineChartData.length > 0 ? (
                <ResponsiveContainer height={280} width="100%">
                  <LineChart data={timelineChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(value) => formatDateShort(value)} />
                    <YAxis />
                    <Tooltip formatter={currencyTooltipFormatter} labelFormatter={(value) => formatDateShort(value)} />
                    <Legend />
                    <Line dataKey="receivable" name="A receber" stroke="#1f8d57" strokeWidth={2} />
                    <Line dataKey="payable" name="A pagar" stroke="#b93a3a" strokeWidth={2} />
                    <Line dataKey="net" name="Saldo" stroke="#1565c0" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </article>

          <article className="panel finance-bi-panel">
            <h2>Receita x Despesa (liquidacao)</h2>
            <div className="chart-box finance-bi-chart-box">
              {liquidationTimelineData.length === 0 ? <p className="muted">Sem liquidacoes no periodo.</p> : null}
              {liquidationTimelineData.length > 0 ? (
                <ResponsiveContainer height={280} width="100%">
                  <LineChart data={liquidationTimelineData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(value) => formatDateShort(value)} />
                    <YAxis />
                    <Tooltip formatter={currencyTooltipFormatter} labelFormatter={(value) => formatDateShort(value)} />
                    <Legend />
                    <Line dataKey="income" name="Receita" stroke="#00b894" strokeWidth={2} />
                    <Line dataKey="expense" name="Despesa" stroke="#d63031" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </article>

          <article className="panel finance-bi-panel">
            <h2>Despesas por tipo</h2>
            <div className="chart-box finance-bi-chart-box">
              {payableByExpenseTypePieData.length === 0 ? <p className="muted">Sem despesas no periodo.</p> : null}
              {payableByExpenseTypePieData.length > 0 ? (
                <ResponsiveContainer height={280} width="100%">
                  <PieChart>
                    <Tooltip
                      formatter={(value, _name, item) => {
                        const share = Number(item?.payload?.sharePercent || 0);
                        return [`${formatCurrency(Number(value || 0))} (${share.toFixed(1)}%)`, "Pagamento"];
                      }}
                    />
                    <Legend />
                    <Pie
                      cx="50%"
                      cy="50%"
                      data={payableByExpenseTypePieData}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={92}
                    >
                      {payableByExpenseTypePieData.map((entry, index) => (
                        <Cell fill={CHART_COLORS[index % CHART_COLORS.length]} key={`${entry.name}-${entry.value}`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </article>

          <article className="panel finance-bi-panel">
            <h2>Receitas por cliente</h2>
            <div className="chart-box finance-bi-chart-box">
              {receivableByClientPieData.length === 0 ? <p className="muted">Sem receitas no periodo.</p> : null}
              {receivableByClientPieData.length > 0 ? (
                <ResponsiveContainer height={280} width="100%">
                  <PieChart>
                    <Tooltip
                      formatter={(value, _name, item) => {
                        const share = Number(item?.payload?.sharePercent || 0);
                        return [`${formatCurrency(Number(value || 0))} (${share.toFixed(1)}%)`, "Faturamento"];
                      }}
                    />
                    <Legend />
                    <Pie
                      cx="50%"
                      cy="50%"
                      data={receivableByClientPieData}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={92}
                    >
                      {receivableByClientPieData.map((entry, index) => (
                        <Cell fill={CHART_COLORS[index % CHART_COLORS.length]} key={`${entry.name}-${entry.value}`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </article>
        </div>

        <div className="chart-grid finance-bi-chart-grid finance-bi-chart-grid-bottom">
          <article className="panel finance-bi-panel">
            <h2>Ganhos por tatuador</h2>
            <div className="chart-box finance-bi-chart-box">
              {artistEarningsPieData.length === 0 ? <p className="muted">Sem ganhos para o periodo.</p> : null}
              {artistEarningsPieData.length > 0 ? (
                <ResponsiveContainer height={280} width="100%">
                  <PieChart>
                    <Tooltip formatter={currencyTooltipFormatter} />
                    <Legend />
                    <Pie
                      cx="50%"
                      cy="50%"
                      data={artistEarningsPieData}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={92}
                    >
                      {artistEarningsPieData.map((entry, index) => (
                        <Cell fill={CHART_COLORS[index % CHART_COLORS.length]} key={`${entry.name}-${entry.value}`} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </article>

          <article className="panel finance-bi-panel">
            <h2>Indicadores de risco</h2>
            <ul className="list finance-bi-risk-list">
              <li>
                <strong>Indice de inadimplencia (receber)</strong>
                <span>{toPercent(totals.receivableDelinquencyRate)}</span>
              </li>
              <li>
                <strong>Receber atrasado no periodo</strong>
                <span>{formatCurrency(totals.overdueReceivable)}</span>
              </li>
              <li>
                <strong>Pagar atrasado no periodo</strong>
                <span>{formatCurrency(totals.overduePayable)}</span>
              </li>
              <li>
                <strong>Saldo liquido projetado</strong>
                <span>{formatCurrency(totals.netProjected)}</span>
              </li>
              <li>
                <strong>Saldo liquido realizado</strong>
                <span>{formatCurrency(totals.netLiquidated)}</span>
              </li>
            </ul>
          </article>
        </div>

        <section className="panel finance-bi-panel finance-bi-table-panel">
          <header className="finance-bi-block-header">
            <h2>Carteira pendente</h2>
            <span>Prioridade por vencimento e impacto financeiro</span>
          </header>
          <div className="table-wrapper registry-table finance-bi-table-wrapper">
            {pendingEntries.length === 0 ? <p className="muted">Sem lancamentos pendentes no periodo.</p> : null}
            {pendingEntries.length > 0 ? (
              <table className="finance-bi-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Contraparte</th>
                    <th>Descricao</th>
                    <th>Emissao</th>
                    <th>Vencimento</th>
                    <th>Dias em atraso</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingEntries.map((row) => {
                    const overdueDays = daysOverdue(row.due_date, today);
                    return (
                      <tr key={`${row.entry_type}-${row.entry_id}`}>
                        <td>{ENTRY_TYPE_LABELS[row.entry_type] || row.entry_type}</td>
                        <td>{row.counterparty_name || "-"}</td>
                        <td>{row.description || "-"}</td>
                        <td>{formatDateShort(row.issue_date)}</td>
                        <td>{formatDateShort(row.due_date)}</td>
                        <td>{overdueDays > 0 ? overdueDays : "-"}</td>
                        <td>{formatCurrency(row.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
