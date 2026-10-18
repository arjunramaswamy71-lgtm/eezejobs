package eezejobs;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Every month end, gives each stock its trend label, then checks how it did over the
 * next 3 months (63 trading days) compared with the market.
 */
public class Backtester {
    public static final int HORIZON = 63;
    private final PriceTable table;
    private final String market;

    public Backtester(PriceTable table, String market) {
        this.table = table;
        this.market = market;
    }

    /** The last trading day of each month, from start until there are 3 months of data left. */
    public List<Integer> monthEnds(LocalDate start) {
        List<LocalDate> d = table.dates();
        List<Integer> out = new ArrayList<>();
        int lastAllowed = d.size() - HORIZON - 1;
        for (int i = 0; i < d.size(); i++) {
            boolean lastOfMonth = i == d.size() - 1 || d.get(i + 1).getMonthValue() != d.get(i).getMonthValue();
            if (lastOfMonth && !d.get(i).isBefore(start) && i <= lastAllowed) {
                out.add(i);
            }
        }
        return out;
    }

    public Map<String, GroupStats> run(LocalDate start) {
        Map<String, GroupStats> groups = new LinkedHashMap<>();
        for (String lab : new String[] {"Strong uptrend", "Uptrend", "Mixed", "Downtrend"}) {
            groups.put(lab, new GroupStats(lab));
        }
        double[] m = table.series(market);
        List<Integer> ends = monthEnds(start);
        for (String t : table.tickers()) {
            if (t.equals(market)) {
                continue;
            }
            double[] p = table.series(t);
            TrendSignal sig = new TrendSignal(p, m);
            for (int i : ends) {
                int s = sig.score(i);
                double fwd = Indicators.shifted(p, i, -HORIZON) / p[i] - 1;
                double mfwd = Indicators.shifted(m, i, -HORIZON) / m[i] - 1;
                double excess = fwd - mfwd;
                if (s >= 0 && !Double.isNaN(excess)) {
                    groups.get(TrendSignal.label(s)).add(fwd, excess);
                }
            }
        }
        return groups;
    }
}
