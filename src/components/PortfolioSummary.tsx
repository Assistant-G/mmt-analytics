/**
 * Portfolio Summary Component
 *
 * Shows aggregated performance across all vaults
 */

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Wallet, Activity, Target, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getPortfolioSummary, migratePerformanceData } from '@/services/performanceService';
import { formatCurrency } from '@/utils';

export function PortfolioSummary() {
  const [summary, setSummary] = useState(() => {
    // Run migration to clean up old invalid data
    migratePerformanceData();
    return getPortfolioSummary();
  });
  const [lastUpdate, setLastUpdate] = useState(Date.now());

  // Refresh portfolio summary every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setSummary(getPortfolioSummary());
      setLastUpdate(Date.now());
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setSummary(getPortfolioSummary());
    setLastUpdate(Date.now());
  };

  if (summary.totalVaults === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-muted-foreground">No vaults yet. Create your first vault to start tracking performance!</p>
        </CardContent>
      </Card>
    );
  }

  const isProfitable = summary.totalPnl > 0;

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-muted-foreground">
            Last updated: {new Date(lastUpdate).toLocaleTimeString()}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold">{formatCurrency(summary.totalValueUsd)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {summary.activeVaults} of {summary.totalVaults} active
                </p>
              </div>
              <Wallet className="w-5 h-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card className={isProfitable ? 'border-green-500/50' : 'border-red-500/50'}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total PnL</p>
                <p className={`text-2xl font-bold ${isProfitable ? 'text-green-500' : 'text-red-500'}`}>
                  {formatCurrency(summary.totalPnl)}
                </p>
                <p className={`text-sm flex items-center gap-1 ${isProfitable ? 'text-green-500' : 'text-red-500'}`}>
                  {isProfitable ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {summary.totalPnlPercent > 0 ? '+' : ''}
                  {summary.totalPnlPercent.toFixed(2)}%
                </p>
              </div>
              {isProfitable ? <TrendingUp className="w-5 h-5 text-green-500" /> : <TrendingDown className="w-5 h-5 text-red-500" />}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Fees</p>
                <p className="text-2xl font-bold">{formatCurrency(summary.totalFeesUsd)}</p>
              </div>
              <Activity className="w-5 h-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total IL</p>
                <p className="text-2xl font-bold text-orange-500">
                  {formatCurrency(summary.totalDivergenceLoss)}
                </p>
              </div>
              <Target className="w-5 h-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Best/Worst Performers */}
      {summary.bestPerformer.vaultId && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                Best Performer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-mono">
                  {summary.bestPerformer.vaultId.slice(0, 10)}...
                </p>
                <p className="text-2xl font-bold text-green-500">
                  +{summary.bestPerformer.pnlPercent.toFixed(2)}%
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-500" />
                Worst Performer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-mono">
                  {summary.worstPerformer.vaultId.slice(0, 10)}...
                </p>
                <p className="text-2xl font-bold text-red-500">
                  {summary.worstPerformer.pnlPercent.toFixed(2)}%
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* By Strategy */}
      <Card>
        <CardHeader>
          <CardTitle>Performance by Strategy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(summary.byStrategy).map(([strategy, stats]) => (
              <div
                key={strategy}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{strategy}</p>
                    <Badge variant="outline" className="text-xs">
                      {stats.vaultCount} vault{stats.vaultCount !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    TVL: {formatCurrency(stats.totalValueUsd)}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-lg font-bold ${stats.avgPnlPercent > 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {stats.avgPnlPercent > 0 ? '+' : ''}
                    {stats.avgPnlPercent.toFixed(2)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(stats.totalFeesUsd)} fees
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
