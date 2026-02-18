/**
 * Strategy Performance Component
 *
 * Displays comprehensive performance metrics for a vault's LP strategy including:
 * - Before/During/After comparison
 * - PnL tracking (realized + unrealized)
 * - Impermanent Loss tracking
 * - Token amount changes
 * - Range history
 * - Strategy effectiveness vs HODL
 */

import { useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Target,
  AlertTriangle,
  Clock,
  Repeat,
  BarChart3,
  ArrowUpRight,
  ArrowRightLeft,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useVaultPerformance } from '@/hooks/useVaultPerformance';
import { comparePerformance } from '@/services/performanceService';
import { getTokenPriceSync } from '@/services/priceService';
import { calculateRebalance } from '@/services/rebalanceService';
import { formatCurrency, formatPreciseCurrency } from '@/utils';
import { Button } from '@/components/ui/button';

interface StrategyPerformanceProps {
  vaultId: string;
}

export function StrategyPerformance({ vaultId }: StrategyPerformanceProps) {
  const { performance, isLoading } = useVaultPerformance(vaultId);
  const comparison = useMemo(() =>
    performance ? comparePerformance(vaultId) : null,
    [vaultId, performance]
  );

  // Calculate rebalance info - must be called before early returns (React hooks rule)
  const rebalanceInfo = useMemo(() => {
    if (!performance) return null;
    const { initialSnapshot, currentSnapshot } = performance;
    return calculateRebalance(
      parseFloat(initialSnapshot.tokenAAmount),
      parseFloat(initialSnapshot.tokenBAmount),
      parseFloat(currentSnapshot.tokenAAmount),
      parseFloat(currentSnapshot.tokenBAmount),
      initialSnapshot.tokenASymbol,
      initialSnapshot.tokenBSymbol
    );
  }, [performance]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!performance || !comparison) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            No performance data available for this vault yet.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Performance tracking will begin after the first cycle completes.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { metrics, initialSnapshot, currentSnapshot } = performance;
  const isProfitable = metrics.totalPnl > 0;
  const isOutperformingHodl = metrics.vsHodlPercent > 0;

  // Get CURRENT prices for both initial and current display (for accurate comparison)
  const currentTokenAPrice = getTokenPriceSync(initialSnapshot.tokenASymbol);
  const currentTokenBPrice = getTokenPriceSync(initialSnapshot.tokenBSymbol);

  // Recalculate initial value with current prices
  const initialValueWithCurrentPrices =
    parseFloat(initialSnapshot.tokenAAmount) * currentTokenAPrice +
    parseFloat(initialSnapshot.tokenBAmount) * currentTokenBPrice;

  // Calculate total xSUI rewards amount
  const xSuiRewards = currentSnapshot.rewardsCollected?.find(r =>
    r.symbol === 'xSUI' || r.coinType.toLowerCase().includes('x_sui')
  );
  const xSuiAmount = xSuiRewards ? parseFloat(xSuiRewards.amount) : 0;
  const hasRewards = metrics.totalRewardsUsd > 0 || xSuiAmount > 0;

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          icon={DollarSign}
          label="Total PnL"
          value={formatCurrency(metrics.totalPnl)}
          percent={metrics.totalPnlPercent}
          trend={isProfitable ? 'up' : 'down'}
          highlight
        />
        <MetricCard
          icon={Activity}
          label="Fees Collected"
          value={formatCurrency(metrics.totalFeesUsd)}
          subtext={`${parseFloat(currentSnapshot.feesCollectedA).toFixed(4)} ${currentSnapshot.tokenASymbol} + ${parseFloat(currentSnapshot.feesCollectedB).toFixed(4)} ${currentSnapshot.tokenBSymbol}`}
          trend="neutral"
        />
        <MetricCard
          icon={TrendingUp}
          label="Rewards Earned"
          value={hasRewards ? `${xSuiAmount.toFixed(6)} xSUI` : formatCurrency(0)}
          subtext={hasRewards ? `≈ ${formatCurrency(metrics.totalRewardsUsd)}` : 'No rewards yet'}
          trend={hasRewards ? 'up' : 'neutral'}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Impermanent Loss"
          value={formatCurrency(metrics.totalDivergenceLoss)}
          percent={metrics.totalDivergenceLoss > 0 ? -Math.abs(metrics.totalDivergenceLoss / metrics.totalFeesUsd * 100) : 0}
          trend={metrics.totalDivergenceLoss > 0 ? 'down' : 'neutral'}
        />
        <MetricCard
          icon={Zap}
          label="ZAP Costs"
          value={formatCurrency(metrics.totalZapCostUsd)}
          subtext={metrics.zapRebalanceCount > 0
            ? `${metrics.zapRebalanceCount} ZAP rebalances (avg ${formatCurrency(metrics.avgZapCostPerRebalance)}/ea)`
            : 'No ZAP rebalances'}
          trend={metrics.totalZapCostUsd > 0 ? 'down' : metrics.totalZapCostUsd < 0 ? 'up' : 'neutral'}
        />
        <MetricCard
          icon={Target}
          label="Net After Costs"
          value={formatCurrency(metrics.netAfterZap)}
          subtext={`Gas: ${formatCurrency(metrics.estimatedGasCostUsd)} | ZAP: ${formatCurrency(metrics.totalZapCostUsd)}`}
          trend={metrics.netAfterZap > 0 ? 'up' : 'down'}
        />
      </div>

      {/* Before/After Comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Before vs After
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Before */}
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-muted-foreground">
                Initial (Cycle 0)
              </h4>
              <div className="space-y-2">
                <TokenAmount
                  symbol={initialSnapshot.tokenASymbol}
                  amount={initialSnapshot.tokenAAmount}
                  usdValue={parseFloat(initialSnapshot.tokenAAmount) * currentTokenAPrice}
                />
                <TokenAmount
                  symbol={initialSnapshot.tokenBSymbol}
                  amount={initialSnapshot.tokenBAmount}
                  usdValue={parseFloat(initialSnapshot.tokenBAmount) * currentTokenBPrice}
                />
                <div className="pt-2 border-t">
                  <p className="text-sm font-semibold">
                    Total: {formatCurrency(initialValueWithCurrentPrices)}
                  </p>
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <ArrowUpRight className={`w-8 h-8 ${isProfitable ? 'text-green-500' : 'text-red-500'}`} />
                <Badge variant={isProfitable ? 'default' : 'destructive'}>
                  {comparison.changes.valueDeltaPercent > 0 ? '+' : ''}
                  {comparison.changes.valueDeltaPercent.toFixed(2)}%
                </Badge>
              </div>
            </div>

            {/* After */}
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-muted-foreground">
                Current (Cycle {currentSnapshot.cycleNumber})
              </h4>
              <div className="space-y-2">
                <TokenAmount
                  symbol={currentSnapshot.tokenASymbol}
                  amount={currentSnapshot.tokenAAmount}
                  usdValue={parseFloat(currentSnapshot.tokenAAmount) * currentSnapshot.tokenAPrice}
                  delta={comparison.changes.tokenADeltaPercent}
                />
                <TokenAmount
                  symbol={currentSnapshot.tokenBSymbol}
                  amount={currentSnapshot.tokenBAmount}
                  usdValue={parseFloat(currentSnapshot.tokenBAmount) * currentSnapshot.tokenBPrice}
                  delta={comparison.changes.tokenBDeltaPercent}
                />
                <div className="pt-2 border-t">
                  <p className="text-sm font-semibold">
                    Total: {formatCurrency(currentSnapshot.totalValueUsd + metrics.totalRewardsUsd)}
                  </p>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>+ {formatCurrency(currentSnapshot.feesCollectedUsd)} fees</p>
                    {metrics.totalRewardsUsd > 0 && (
                      <p className="text-green-500">+ {formatCurrency(metrics.totalRewardsUsd)} rewards</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strategy vs HODL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Strategy vs HODL
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">If you just held tokens</span>
                <Badge variant="outline">HODL</Badge>
              </div>
              <p className="text-2xl font-bold">
                {formatCurrency(metrics.hodlValue)}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">With LP strategy</span>
                <Badge variant={isOutperformingHodl ? 'default' : 'secondary'}>
                  Strategy
                </Badge>
              </div>
              <p className="text-2xl font-bold">
                {formatCurrency(metrics.lpValue)}
              </p>
              <p className={`text-sm flex items-center gap-1 ${isOutperformingHodl ? 'text-green-500' : 'text-red-500'}`}>
                {isOutperformingHodl ? (
                  <>
                    <TrendingUp className="w-4 h-4" />
                    {metrics.vsHodlPercent.toFixed(2)}% better than HODL
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-4 h-4" />
                    {Math.abs(metrics.vsHodlPercent).toFixed(2)}% worse than HODL
                  </>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Efficiency Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Efficiency Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricItem
              label="Time in Range"
              value={`${metrics.avgTimeInRange.toFixed(1)}%`}
              icon={Target}
            />
            <MetricItem
              label="Avg Fees/Cycle"
              value={formatCurrency(metrics.avgFeesPerCycle)}
              icon={Repeat}
            />
            <MetricItem
              label="Range Changes"
              value={metrics.rangeChanges.toString()}
              icon={Activity}
            />
            <MetricItem
              label="Current APY"
              value={`${metrics.currentApy.toFixed(1)}%`}
              icon={TrendingUp}
            />
          </div>
        </CardContent>
      </Card>

      {/* ZAP History */}
      {performance.zapHistory && performance.zapHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-500" />
              ZAP History
              <Badge variant="outline" className="ml-2">
                {metrics.zapRebalanceCount} ZAP / {metrics.nonZapRebalanceCount} non-ZAP
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-4 border-b">
                <div>
                  <p className="text-xs text-muted-foreground">Total ZAP Cost</p>
                  <p className={`text-lg font-semibold ${metrics.totalZapCostUsd > 0 ? 'text-red-500' : metrics.totalZapCostUsd < 0 ? 'text-green-500' : ''}`}>
                    {formatCurrency(metrics.totalZapCostUsd)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Avg Cost/Rebalance</p>
                  <p className="text-lg font-semibold">
                    {formatCurrency(metrics.avgZapCostPerRebalance)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fees Collected</p>
                  <p className="text-lg font-semibold text-green-500">
                    {formatCurrency(metrics.totalFeesUsd)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Net (Fees - ZAP)</p>
                  <p className={`text-lg font-semibold ${metrics.totalFeesUsd - metrics.totalZapCostUsd > 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {formatCurrency(metrics.totalFeesUsd - metrics.totalZapCostUsd)}
                  </p>
                </div>
              </div>

              {/* Rebalance History Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium">#</th>
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium">Time</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">ZAP</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">Swap Value</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">Pool Fee</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">Slippage</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">Total Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.zapHistory.slice().reverse().map((event) => (
                      <tr key={event.rebalanceNumber} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 px-2 font-mono">{event.rebalanceNumber}</td>
                        <td className="py-2 px-2 text-muted-foreground">
                          {new Date(event.timestamp).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {event.usedZap ? (
                            <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">
                              <Zap className="w-3 h-3 mr-1" />
                              ZAP
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              No ZAP
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">
                          {event.usedZap ? formatPreciseCurrency(event.swapValueUsd) : '-'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-red-400">
                          {event.usedZap ? `-${formatPreciseCurrency(event.poolFeeUsd)}` : '-'}
                        </td>
                        <td className={`py-2 px-2 text-right font-mono ${event.slippageUsd > 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {event.usedZap ? formatPreciseCurrency(-event.slippageUsd) : '-'}
                        </td>
                        <td className={`py-2 px-2 text-right font-mono font-semibold ${event.totalCostUsd > 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {event.usedZap ? formatPreciseCurrency(-event.totalCostUsd) : '$0'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td colSpan={3} className="py-2 px-2">Total ZAP Costs</td>
                      <td className="py-2 px-2 text-right">
                        {formatPreciseCurrency(performance.zapHistory.filter(e => e.usedZap).reduce((sum, e) => sum + e.swapValueUsd, 0))}
                      </td>
                      <td className="py-2 px-2 text-right text-red-400">
                        -{formatPreciseCurrency(performance.zapHistory.filter(e => e.usedZap).reduce((sum, e) => sum + e.poolFeeUsd, 0))}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {(() => { const v = performance.zapHistory.filter(e => e.usedZap).reduce((sum, e) => sum + e.slippageUsd, 0); return formatPreciseCurrency(-v); })()}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {formatPreciseCurrency(-metrics.totalZapCostUsd)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                * Swap values and costs are from actual on-chain data. Pool fee rate: {(performance.zapHistory[0]?.poolFeeRate * 100).toFixed(2) || 0.25}%.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Range History */}
      {currentSnapshot.tickLower !== undefined && currentSnapshot.tickUpper !== undefined && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              Current Range
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Tick Range</p>
                  <p className="font-mono text-sm">
                    {currentSnapshot.tickLower} → {currentSnapshot.tickUpper}
                  </p>
                </div>
                <Badge variant={currentSnapshot.isInRange ? 'default' : 'destructive'}>
                  {currentSnapshot.isInRange ? '✓ In Range' : '✗ Out of Range'}
                </Badge>
              </div>
              {currentSnapshot.currentTick !== undefined && (
                <div>
                  <p className="text-sm text-muted-foreground">Current Tick</p>
                  <p className="font-mono">{currentSnapshot.currentTick}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rebalance Recommendation */}
      {rebalanceInfo?.needsRebalance && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-orange-500" />
              Rebalance to Original Position
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Token ratios changed during LP. Swap to restore your original amounts:
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">{rebalanceInfo.tokenASymbol}</p>
                  <p className="font-mono text-sm">
                    {rebalanceInfo.tokenACurrent.toFixed(4)} → {rebalanceInfo.tokenAInitial.toFixed(4)}
                  </p>
                  <p className={`text-xs ${rebalanceInfo.tokenADiff > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {rebalanceInfo.tokenADiff > 0 ? 'Need' : 'Excess'}: {Math.abs(rebalanceInfo.tokenADiff).toFixed(4)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">{rebalanceInfo.tokenBSymbol}</p>
                  <p className="font-mono text-sm">
                    {rebalanceInfo.tokenBCurrent.toFixed(4)} → {rebalanceInfo.tokenBInitial.toFixed(4)}
                  </p>
                  <p className={`text-xs ${rebalanceInfo.tokenBDiff > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {rebalanceInfo.tokenBDiff > 0 ? 'Need' : 'Excess'}: {Math.abs(rebalanceInfo.tokenBDiff).toFixed(4)}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-medium">
                    Swap {rebalanceInfo.swapFromAmount.toFixed(4)} {rebalanceInfo.swapFromSymbol}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-sm font-medium">
                    ~{rebalanceInfo.swapToAmount.toFixed(4)} {rebalanceInfo.swapToSymbol}
                  </span>
                </div>
                <Badge variant="outline" className="text-orange-500">
                  ~{formatCurrency(rebalanceInfo.swapValueUsd)}
                </Badge>
              </div>

              <Button
                variant="outline"
                className="w-full border-orange-500/30 text-orange-500 hover:bg-orange-500/10"
                onClick={() => {
                  // TODO: Open swap modal or redirect to DEX
                  window.open(
                    `https://app.mmt.finance/swap?from=${rebalanceInfo.swapFromSymbol}&to=${rebalanceInfo.swapToSymbol}&amount=${rebalanceInfo.swapFromAmount}`,
                    '_blank'
                  );
                }}
              >
                <ArrowRightLeft className="w-4 h-4 mr-2" />
                Open Swap on MMT Finance
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Time Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Time Active</p>
                <p className="text-lg font-semibold">
                  {formatDuration(metrics.totalTimeActive)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Repeat className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Total Cycles</p>
                <p className="text-lg font-semibold">{metrics.numberOfCycles}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Max Drawdown</p>
                <p className="text-lg font-semibold text-red-500">
                  {metrics.maxDrawdownPercent.toFixed(2)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Helper Components

function MetricCard({
  icon: Icon,
  label,
  value,
  percent,
  subtext,
  trend,
  highlight = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  percent?: number;
  subtext?: string;
  trend: 'up' | 'down' | 'neutral';
  highlight?: boolean;
}) {
  const trendColor =
    trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-500';
  const TrendIcon =
    trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Activity;

  return (
    <Card className={highlight ? 'border-primary' : ''}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {percent !== undefined && (
              <p className={`text-sm flex items-center gap-1 ${trendColor}`}>
                <TrendIcon className="w-4 h-4" />
                {percent > 0 ? '+' : ''}
                {percent.toFixed(2)}%
              </p>
            )}
            {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
          </div>
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function TokenAmount({
  symbol,
  amount,
  usdValue,
  delta,
}: {
  symbol: string;
  amount: string;
  usdValue: number;
  delta?: number;
}) {
  return (
    <div className="flex items-center justify-between p-2 rounded bg-muted/50">
      <div>
        <p className="font-medium">
          {parseFloat(amount).toFixed(6)} {symbol}
        </p>
        <p className="text-xs text-muted-foreground">{formatCurrency(usdValue)}</p>
      </div>
      {delta !== undefined && delta !== 0 && (
        <Badge variant={delta > 0 ? 'default' : 'secondary'} className="text-xs">
          {delta > 0 ? '+' : ''}
          {delta.toFixed(1)}%
        </Badge>
      )}
    </div>
  );
}

function MetricItem({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
